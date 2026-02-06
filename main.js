require('dotenv').config();

const { app, BrowserWindow, ipcMain, screen, globalShortcut, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const { randomUUID, createHash } = require('crypto');

const PANEL = {
  expandedWidth: 360,
  collapsedWidth: 20,
  collapsedHeight: 100,
  topPadding: 12,
  bottomPadding: 12,
  collapseDelayMs: 180,
  edgeThresholdPx: 10,
  hoverPollMs: 120,
  topMostHeartbeatMs: 800,
};

const AUTO_CAPTURE = {
  pollMs: 1300,
  minChars: 24,
  maxChars: 5000,
  maxWordCount: 900,
  dedupeWindowMs: 8 * 60 * 1000,
};

let mainWindow;
let collapseTimer;
let hoverTimer;
let topMostTimer;
let clipboardTimer;
let lastClipboardHash = '';
let recentAutoHashes = new Map();
let panelExpanded = false;
let inMemoryState;
let rendererHovering = false;

function enforceTopMost() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const level = process.platform === 'darwin' ? 'screen-saver' : 'floating';
  mainWindow.setAlwaysOnTop(true, level, 1);
  mainWindow.moveTop();

  try {
    mainWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
      skipTransformProcessType: false,
    });
  } catch {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }
}

function getStatePath() {
  return path.join(app.getPath('userData'), 'thought-partner-state.json');
}

function defaultState() {
  const initialNoteId = randomUUID();
  return {
    notes: [
      {
        id: initialNoteId,
        title: 'Scratchpad',
        content: '',
        tags: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    activeNoteId: initialNoteId,
    prompts: [],
    sessions: [],
    goals: [],
    suggestions: [],
    preferences: {
      pinned: false,
      dock: 'right',
      autoCapturePrompts: true,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function safeText(value) {
  return String(value || '').trim();
}

function normalizeForHash(value) {
  return safeText(value)
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 4000);
}

function hashText(value) {
  return createHash('sha1').update(normalizeForHash(value)).digest('hex');
}

function isLikelyPrompt(text) {
  const value = safeText(text);
  if (!value) {
    return false;
  }

  if (value.length < AUTO_CAPTURE.minChars || value.length > AUTO_CAPTURE.maxChars) {
    return false;
  }

  const words = value.split(/\s+/);
  if (words.length < 5 || words.length > AUTO_CAPTURE.maxWordCount) {
    return false;
  }

  if (/^[a-z]+:\/\/\S+$/i.test(value)) {
    return false;
  }

  const hasQuestion = value.includes('?');
  const startsWithAction = /^(build|create|write|generate|fix|implement|refactor|add|debug|review|design|optimize|explain|analyze|plan|draft|help|make)\b/i.test(value);
  const hasAssistantContext = /\b(prompt|assistant|llm|model|chatgpt|claude|gemini|cursor|codex|copilot|feature|bug|test|api|workflow)\b/i.test(value);
  const hasInstruction = /\b(please|can you|how do i|what is|show me|give me|need to|i want)\b/i.test(value);

  return hasQuestion || startsWithAction || (hasAssistantContext && hasInstruction);
}

function pruneRecentAutoHashes() {
  const now = Date.now();
  for (const [hash, ts] of recentAutoHashes.entries()) {
    if (now - ts > AUTO_CAPTURE.dedupeWindowMs) {
      recentAutoHashes.delete(hash);
    }
  }
}

function normalizeNote(note, index = 0) {
  const now = new Date().toISOString();
  return {
    id: safeText(note?.id) || randomUUID(),
    title: safeText(note?.title) || `Note ${index + 1}`,
    content: String(note?.content || ''),
    tags: Array.isArray(note?.tags)
      ? note.tags.map((tag) => safeText(tag)).filter(Boolean).slice(0, 12)
      : [],
    createdAt: safeText(note?.createdAt) || now,
    updatedAt: safeText(note?.updatedAt) || now,
  };
}

function normalizePrompt(prompt) {
  const now = new Date().toISOString();
  const tool = safeText(prompt?.tool) || 'codex-cli';
  const sessionLabel = safeText(prompt?.sessionLabel) || `${tool} default`;
  const sessionId = safeText(prompt?.sessionId)
    || `session-${tool}-${sessionLabel.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

  return {
    id: safeText(prompt?.id) || randomUUID(),
    text: safeText(prompt?.text),
    outcome: safeText(prompt?.outcome),
    tool,
    sessionId,
    sessionLabel,
    noteId: safeText(prompt?.noteId) || null,
    createdAt: safeText(prompt?.createdAt) || now,
  };
}

function normalizeSession(session) {
  const now = new Date().toISOString();
  return {
    id: safeText(session?.id) || randomUUID(),
    tool: safeText(session?.tool) || 'codex-cli',
    label: safeText(session?.label) || 'Untitled session',
    promptCount: Number.isFinite(session?.promptCount) ? session.promptCount : 0,
    lastPromptAt: safeText(session?.lastPromptAt) || now,
  };
}

function normalizeSuggestion(suggestion) {
  return {
    prompt: safeText(suggestion?.prompt),
    reason: safeText(suggestion?.reason),
    tool: safeText(suggestion?.tool) || 'codex-cli',
    sessionLabel: safeText(suggestion?.sessionLabel),
  };
}

function buildSessionsFromPrompts(prompts) {
  const byId = new Map();

  prompts.forEach((prompt) => {
    if (!prompt.text) {
      return;
    }

    const id = prompt.sessionId || `${prompt.tool}-${prompt.sessionLabel}`;
    const existing = byId.get(id);

    if (!existing) {
      byId.set(id, {
        id,
        tool: prompt.tool || 'codex-cli',
        label: prompt.sessionLabel || 'Untitled session',
        promptCount: 1,
        lastPromptAt: prompt.createdAt || new Date().toISOString(),
      });
      return;
    }

    existing.promptCount += 1;
    if (new Date(prompt.createdAt || 0).getTime() > new Date(existing.lastPromptAt || 0).getTime()) {
      existing.lastPromptAt = prompt.createdAt;
    }
  });

  return [...byId.values()].sort((a, b) => (
    new Date(b.lastPromptAt || 0).getTime() - new Date(a.lastPromptAt || 0).getTime()
  ));
}

function normalizeState(rawState) {
  const base = defaultState();
  const parsed = rawState || {};
  let notes;

  if (Array.isArray(parsed.notes)) {
    notes = parsed.notes.map((note, index) => normalizeNote(note, index));
  } else if (typeof parsed.notes === 'string') {
    const legacyContent = parsed.notes.trim();
    notes = legacyContent
      ? [
          normalizeNote({
            title: 'Migrated note',
            content: legacyContent,
          }, 0),
        ]
      : [];
  } else {
    notes = [];
  }

  if (!notes.length) {
    notes = base.notes;
  }

  const prompts = Array.isArray(parsed.prompts)
    ? parsed.prompts.map((prompt) => normalizePrompt(prompt)).filter((prompt) => prompt.text)
    : [];

  const sessionSeed = Array.isArray(parsed.sessions) && parsed.sessions.length
    ? parsed.sessions.map((session) => normalizeSession(session))
    : buildSessionsFromPrompts(prompts);

  const activeNoteExists = notes.some((note) => note.id === parsed.activeNoteId);
  const activeNoteId = activeNoteExists ? parsed.activeNoteId : notes[0].id;

  return {
    ...base,
    ...parsed,
    notes,
    activeNoteId,
    prompts,
    sessions: sessionSeed,
    goals: Array.isArray(parsed.goals)
      ? parsed.goals.map((goal) => safeText(goal)).filter(Boolean)
      : [],
    suggestions: Array.isArray(parsed.suggestions)
      ? parsed.suggestions.map((suggestion) => normalizeSuggestion(suggestion)).filter((suggestion) => suggestion.prompt)
      : [],
    preferences: {
      ...base.preferences,
      ...(parsed.preferences || {}),
    },
    createdAt: safeText(parsed.createdAt) || base.createdAt,
    updatedAt: safeText(parsed.updatedAt) || base.updatedAt,
  };
}

function trimForModel(text, maxLen = 240) {
  const value = safeText(text);
  return value.length > maxLen ? `${value.slice(0, maxLen)}...` : value;
}

function parseModelSuggestions(content, limit) {
  if (!safeText(content)) {
    return [];
  }

  const normalizedContent = content
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    const parsed = JSON.parse(normalizedContent);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => normalizeSuggestion(item)).filter((item) => item.prompt).slice(0, limit);
    }
  } catch {
    // Fall through to line parser.
  }

  return normalizedContent
    .split('\n')
    .map((line) => safeText(line.replace(/^[\-\d\.\)\s]+/, '')))
    .filter(Boolean)
    .slice(0, limit)
    .map((promptText) => normalizeSuggestion({ prompt: promptText, reason: 'Parsed from free-form model output.' }));
}

function heuristicPromptSuggestions({ notes = [], prompts = [], sessions = [], limit = 6 }) {
  const latestNote = notes[0];
  const latestPrompt = prompts[prompts.length - 1];
  const hottestSession = sessions[0];
  const focus = trimForModel(latestPrompt?.text || latestNote?.content || 'current coding task', 120);

  const suggestions = [
    {
      prompt: `Turn this objective into a thin vertical slice with acceptance criteria: ${focus}`,
      reason: 'Creates a concrete first delivery target.',
      tool: hottestSession?.tool || 'codex-cli',
      sessionLabel: hottestSession?.label || 'delivery-slice',
    },
    {
      prompt: `List likely failure modes for "${focus}" and generate one focused test per failure mode.`,
      reason: 'Builds test coverage early and prevents regressions.',
      tool: 'python',
      sessionLabel: 'risk-tests',
    },
    {
      prompt: `Refactor plan: identify coupling hotspots in this implementation and propose a 3-step low-risk cleanup.`,
      reason: 'Reduces tech debt while feature context is fresh.',
      tool: 'codex-cli',
      sessionLabel: 'refactor-pass',
    },
    {
      prompt: `Create a debugging checklist for this workflow with expected logs, checkpoints, and rollback steps.`,
      reason: 'Makes troubleshooting faster during iteration.',
      tool: hottestSession?.tool || 'bash-cli',
      sessionLabel: 'debug-checklist',
    },
    {
      prompt: `Generate prompts to compare 2 implementation options for "${focus}" with tradeoffs in speed, reliability, and complexity.`,
      reason: 'Improves decision quality before writing more code.',
      tool: 'codex-cli',
      sessionLabel: 'design-review',
    },
    {
      prompt: `Based on the latest notes, draft the next 3 prompts I should run today in strict execution order.`,
      reason: 'Keeps momentum and reduces context switching.',
      tool: hottestSession?.tool || 'codex-cli',
      sessionLabel: 'daily-sequence',
    },
  ];

  return suggestions.slice(0, limit).map((item) => normalizeSuggestion(item));
}

async function evolvePromptsWithGroq({ notes = [], prompts = [], sessions = [], limit = 6 }) {
  const apiKey = safeText(process.env.GROQ_API_KEY);
  if (!apiKey) {
    return {
      source: 'heuristic',
      items: heuristicPromptSuggestions({ notes, prompts, sessions, limit }),
      message: 'No GROQ_API_KEY set, using heuristic suggestions.',
    };
  }

  const recentPrompts = prompts.slice(-10).map((prompt) => ({
    text: trimForModel(prompt.text, 180),
    outcome: trimForModel(prompt.outcome, 100),
    tool: prompt.tool,
    sessionLabel: prompt.sessionLabel,
    createdAt: prompt.createdAt,
  }));

  const recentNotes = notes
    .slice(0, 5)
    .map((note) => ({
      title: trimForModel(note.title, 80),
      content: trimForModel(note.content, 220),
      tags: note.tags,
      updatedAt: note.updatedAt,
    }));

  const body = {
    model: 'llama-3.3-70b-versatile',
    temperature: 0.5,
    max_tokens: 700,
    messages: [
      {
        role: 'system',
        content: [
          'You are a prompt-evolution assistant for engineering workflows.',
          'Return ONLY a JSON array of objects with keys:',
          'prompt (string), reason (string), tool (string), sessionLabel (string).',
          'Keep prompts actionable, concrete, and short.',
          `Return at most ${limit} items.`,
        ].join(' '),
      },
      {
        role: 'user',
        content: JSON.stringify({
          request: 'Generate the next best prompts based on notes, session history, and prompt evolution.',
          notes: recentNotes,
          prompts: recentPrompts,
          sessions: sessions.slice(0, 8),
        }),
      },
    ],
  };

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const fallback = heuristicPromptSuggestions({ notes, prompts, sessions, limit });
    return {
      source: 'heuristic',
      items: fallback,
      message: `Groq returned HTTP ${response.status}, using heuristic fallback.`,
    };
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || '';
  const parsed = parseModelSuggestions(content, limit);

  if (!parsed.length) {
    return {
      source: 'heuristic',
      items: heuristicPromptSuggestions({ notes, prompts, sessions, limit }),
      message: 'Model response was empty or invalid JSON, using heuristic fallback.',
    };
  }

  return {
    source: 'groq',
    items: parsed,
    message: 'Generated by Groq prompt-evolution model.',
  };
}

function readState() {
  const filePath = getStatePath();

  try {
    if (!fs.existsSync(filePath)) {
      const state = defaultState();
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2), 'utf8');
      return state;
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (err) {
    console.error('Failed to read state:', err);
    return defaultState();
  }
}

function writeState(partialState) {
  const filePath = getStatePath();
  const previous = inMemoryState || readState();

  const merged = {
    ...previous,
    ...(partialState || {}),
    preferences: {
      ...previous.preferences,
      ...((partialState && partialState.preferences) || {}),
    },
  };
  const next = normalizeState(merged);
  next.createdAt = previous.createdAt || next.createdAt;
  next.updatedAt = new Date().toISOString();

  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf8');
  inMemoryState = next;
  return next;
}

function getState() {
  if (!inMemoryState) {
    inMemoryState = readState();
  }

  return inMemoryState;
}

function appendAutoPromptToTimeline(promptText) {
  const current = getState();
  const timeline = Array.isArray(current.timeline) ? current.timeline.slice(-500) : [];
  const normalizedInput = normalizeForHash(promptText);

  if (!normalizedInput) {
    return null;
  }

  const latest = timeline[timeline.length - 1];
  if (latest && normalizeForHash(latest.text) === normalizedInput) {
    return null;
  }

  const entry = {
    id: randomUUID(),
    type: 'prompt',
    text: safeText(promptText),
    outcome: 'pending',
    source: 'auto-capture',
    createdAt: new Date().toISOString(),
  };

  timeline.push(entry);
  writeState({ timeline });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timeline:autoPromptCaptured', entry);
  }

  return entry;
}

function pollClipboardForPrompts() {
  const current = getState();
  if (current.preferences.autoCapturePrompts === false) {
    return;
  }

  let clipboardText = '';
  try {
    clipboardText = clipboard.readText();
  } catch {
    return;
  }

  const text = safeText(clipboardText);
  if (!text) {
    lastClipboardHash = '';
    return;
  }

  const hash = hashText(text);
  if (hash === lastClipboardHash) {
    return;
  }
  lastClipboardHash = hash;

  if (!isLikelyPrompt(text)) {
    return;
  }

  pruneRecentAutoHashes();
  if (recentAutoHashes.has(hash)) {
    return;
  }

  const entry = appendAutoPromptToTimeline(text);
  if (entry) {
    recentAutoHashes.set(hash, Date.now());
  }
}

function startClipboardWatcher() {
  if (clipboardTimer) {
    clearInterval(clipboardTimer);
  }

  try {
    const seed = safeText(clipboard.readText());
    lastClipboardHash = seed ? hashText(seed) : '';
  } catch {
    lastClipboardHash = '';
  }

  clipboardTimer = setInterval(pollClipboardForPrompts, AUTO_CAPTURE.pollMs);
}

function stopClipboardWatcher() {
  if (!clipboardTimer) {
    return;
  }

  clearInterval(clipboardTimer);
  clipboardTimer = undefined;
}

function getDockBounds(isExpanded, anchorPoint = screen.getCursorScreenPoint()) {
  const display = screen.getDisplayNearestPoint(anchorPoint);
  const area = display.workArea;
  const expandedHeight = area.height - PANEL.topPadding - PANEL.bottomPadding;
  const height = isExpanded ? expandedHeight : PANEL.collapsedHeight;
  const width = isExpanded ? PANEL.expandedWidth : PANEL.collapsedWidth;
  const y = isExpanded
    ? area.y + PANEL.topPadding
    : area.y + Math.round((area.height - height) / 2);

  const state = getState();
  const dock = state.preferences.dock;
  const x = dock === 'left'
    ? area.x
    : area.x + area.width - width;

  return { x, y, width, height };
}

function boundsChanged(a, b) {
  return a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height;
}

function pointInBounds(point, bounds) {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

function isPointNearDockEdge(point, dock, workArea) {
  if (dock === 'left') {
    return point.x <= workArea.x + PANEL.edgeThresholdPx;
  }

  return point.x >= workArea.x + workArea.width - PANEL.edgeThresholdPx;
}

function shouldExpandForPointer() {
  const state = getState();
  if (state.preferences.pinned || rendererHovering) {
    return true;
  }

  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  const area = display.workArea;
  const dock = state.preferences.dock;

  const withinVerticalTrack = point.y >= area.y + PANEL.topPadding
    && point.y <= area.y + area.height - PANEL.bottomPadding;

  if (withinVerticalTrack && isPointNearDockEdge(point, dock, area)) {
    return true;
  }

  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  return pointInBounds(point, mainWindow.getBounds());
}

function clearCollapseTimer() {
  if (collapseTimer) {
    clearTimeout(collapseTimer);
    collapseTimer = undefined;
  }
}

function scheduleCollapse() {
  if (collapseTimer) {
    return;
  }

  collapseTimer = setTimeout(() => {
    setWindowExpanded(false);
    collapseTimer = undefined;
  }, PANEL.collapseDelayMs);
}

function setWindowExpanded(isExpanded, options = {}) {
  const { force = false, focus = false } = options;

  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const bounds = getDockBounds(isExpanded);
  const currentBounds = mainWindow.getBounds();
  const shouldUpdate = force
    || panelExpanded !== isExpanded
    || boundsChanged(bounds, currentBounds);

  if (!shouldUpdate) {
    return;
  }

  panelExpanded = isExpanded;
  mainWindow.setBounds(bounds, true);
  mainWindow.setIgnoreMouseEvents(false);
  enforceTopMost();
  mainWindow.showInactive();

  if (focus) {
    mainWindow.focus();
  }

  mainWindow.webContents.send('panel:expanded', isExpanded);
}

function syncWindowPlacement(force = false) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const targetBounds = getDockBounds(panelExpanded);
  const currentBounds = mainWindow.getBounds();
  if (force || boundsChanged(targetBounds, currentBounds)) {
    mainWindow.setBounds(targetBounds, true);
  }
}

function syncPanelFromPointer() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  syncWindowPlacement();
  enforceTopMost();

  if (shouldExpandForPointer()) {
    clearCollapseTimer();
    setWindowExpanded(true);
    return;
  }

  scheduleCollapse();
}

function startWatchers() {
  if (hoverTimer) {
    clearInterval(hoverTimer);
  }

  if (topMostTimer) {
    clearInterval(topMostTimer);
  }

  hoverTimer = setInterval(syncPanelFromPointer, PANEL.hoverPollMs);
  topMostTimer = setInterval(enforceTopMost, PANEL.topMostHeartbeatMs);
}

function stopWatchers() {
  if (hoverTimer) {
    clearInterval(hoverTimer);
    hoverTimer = undefined;
  }

  if (topMostTimer) {
    clearInterval(topMostTimer);
    topMostTimer = undefined;
  }
}

function createWindow() {
  const state = getState();
  const startsExpanded = Boolean(state.preferences.pinned);

  mainWindow = new BrowserWindow({
    ...getDockBounds(startsExpanded),
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    transparent: false,
    backgroundColor: '#101010',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  enforceTopMost();

  mainWindow.once('ready-to-show', () => {
    enforceTopMost();
    mainWindow.showInactive();
    setWindowExpanded(startsExpanded, { force: true, focus: startsExpanded });
  });

  mainWindow.on('blur', () => {
    if (!getState().preferences.pinned) {
      scheduleCollapse();
    }
  });

  mainWindow.on('focus', () => {
    enforceTopMost();
  });

  screen.on('display-metrics-changed', () => {
    syncWindowPlacement(true);
    setWindowExpanded(panelExpanded, { force: true });
  });

  mainWindow.on('closed', () => {
    stopWatchers();
  });
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  inMemoryState = readState();
  createWindow();
  startWatchers();
  startClipboardWatcher();

  ipcMain.handle('state:get', () => getState());

  ipcMain.handle('state:update', (_event, partialState) => writeState(partialState));
  ipcMain.handle('ai:evolvePrompts', async (_event, payload) => {
    const state = normalizeState(payload || {});
    try {
      return await evolvePromptsWithGroq(state);
    } catch (err) {
      console.error('Prompt evolution failed:', err);
      return {
        source: 'heuristic',
        items: heuristicPromptSuggestions(state),
        message: 'Prompt evolution request failed, using heuristic fallback.',
      };
    }
  });

  ipcMain.on('panel:hover', (_event, isHovering) => {
    rendererHovering = Boolean(isHovering);
    syncPanelFromPointer();
  });

  ipcMain.on('panel:setPinned', (_event, pinned) => {
    const updated = writeState({ preferences: { pinned: Boolean(pinned) } });
    setWindowExpanded(Boolean(updated.preferences.pinned), { force: true, focus: Boolean(updated.preferences.pinned) });
    syncPanelFromPointer();
  });

  ipcMain.on('panel:setDock', (_event, dock) => {
    if (dock !== 'left' && dock !== 'right') {
      return;
    }

    const updated = writeState({ preferences: { dock } });
    setWindowExpanded(panelExpanded || Boolean(updated.preferences.pinned), { force: true });
    syncPanelFromPointer();
  });

  globalShortcut.register('CommandOrControl+Shift+Space', () => {
    writeState({ preferences: { pinned: true } });
    setWindowExpanded(true, { force: true, focus: true });
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      startWatchers();
      startClipboardWatcher();
    } else {
      enforceTopMost();
      syncWindowPlacement(true);
      setWindowExpanded(true, { force: true });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  stopWatchers();
  stopClipboardWatcher();
  clearCollapseTimer();
  globalShortcut.unregisterAll();
});
