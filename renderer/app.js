const DEFAULT_GOAL = 'Build auth + dashboard for Wallace';
const DEFAULT_MILESTONES = ['Auth flow', 'Dashboard layout', 'API routes', 'QA pass'];
const OUTCOMES = ['implemented', 'partial', 'failed', 'pending'];

const state = {
  sessionGoal: DEFAULT_GOAL,
  milestones: [],
  timeline: [],
  sessionStartedAt: null,
  inputMode: 'prompt',
  selectedOutcome: 'pending',
  preferences: {
    pinned: false,
    dock: 'right',
    autoCapturePrompts: true,
  },
  isEditingGoal: false,
  lastAddedEntryId: null,
};

const $ = {
  app: document.getElementById('app'),
  pinToggle: document.getElementById('pinToggle'),
  autoCaptureToggle: document.getElementById('autoCaptureToggle'),
  dockSelect: document.getElementById('dockSelect'),
  sessionTimer: document.getElementById('sessionTimer'),

  goalDisplay: document.getElementById('goalDisplay'),
  goalInput: document.getElementById('goalInput'),

  milestoneList: document.getElementById('milestoneList'),
  progressFill: document.getElementById('progressFill'),
  progressText: document.getElementById('progressText'),
  addMilestoneBtn: document.getElementById('addMilestoneBtn'),

  timelineViewport: document.getElementById('timelineViewport'),
  timelineList: document.getElementById('timelineList'),

  modePrompt: document.getElementById('modePrompt'),
  modeNote: document.getElementById('modeNote'),
  composerInput: document.getElementById('composerInput'),
  outcomeRow: document.getElementById('outcomeRow'),
  submitEntryBtn: document.getElementById('submitEntryBtn'),
};

let timerInterval;
let fallbackStateCache = null;

const thoughtApi = (() => {
  const bridge = window.thoughtPartner;
  if (bridge && typeof bridge.getState === 'function') {
    return bridge;
  }

  return {
    async getState() {
      return fallbackStateCache || {
        sessionGoal: DEFAULT_GOAL,
        milestones: DEFAULT_MILESTONES.map((label) => ({ label, done: false })),
        timeline: [],
        sessionStartedAt: nowIso(),
        preferences: { pinned: true, dock: 'right', autoCapturePrompts: true },
      };
    },
    async updateState(partial) {
      fallbackStateCache = {
        ...(fallbackStateCache || {}),
        ...(partial || {}),
      };
      return fallbackStateCache;
    },
    setHover() {},
    setPinned() {},
    setDock() {},
    onAutoPromptCaptured() {
      return () => {};
    },
    onExpandedChange() {
      return () => {};
    },
  };
})();

function nowIso() {
  return new Date().toISOString();
}

function normalizeText(value) {
  return String(value || '').trim();
}

function formatTime(iso) {
  const value = iso ? new Date(iso) : new Date();
  return value.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDuration(startIso) {
  if (!startIso) {
    return '00:00';
  }

  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - new Date(startIso).getTime()) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function createMilestone(label, done = false) {
  return {
    id: crypto.randomUUID(),
    label: normalizeText(label) || 'Untitled milestone',
    done: Boolean(done),
  };
}

function normalizeMilestones(rawMilestones, rawGoals) {
  if (Array.isArray(rawMilestones) && rawMilestones.length) {
    return rawMilestones
      .map((item) => {
        const label = normalizeText(item?.label);
        if (!label) {
          return null;
        }

        return {
          id: normalizeText(item.id) || crypto.randomUUID(),
          label,
          done: Boolean(item.done),
        };
      })
      .filter(Boolean);
  }

  if (Array.isArray(rawGoals) && rawGoals.length) {
    return rawGoals
      .map((goal) => normalizeText(goal))
      .filter(Boolean)
      .map((goal) => createMilestone(goal, false));
  }

  return DEFAULT_MILESTONES.map((label) => createMilestone(label, false));
}

function normalizeEntry(entry) {
  const type = entry?.type === 'note' ? 'note' : 'prompt';
  const text = normalizeText(entry?.text);
  if (!text) {
    return null;
  }

  const outcome = OUTCOMES.includes(entry?.outcome) ? entry.outcome : 'pending';

  return {
    id: normalizeText(entry?.id) || crypto.randomUUID(),
    type,
    text,
    outcome: type === 'prompt' ? outcome : null,
    createdAt: normalizeText(entry?.createdAt) || nowIso(),
  };
}

function deriveTimelineFromLegacy(raw) {
  const entries = [];

  if (Array.isArray(raw.prompts)) {
    raw.prompts.forEach((prompt) => {
      const text = normalizeText(prompt?.text);
      if (!text) {
        return;
      }

      entries.push({
        id: normalizeText(prompt?.id) || crypto.randomUUID(),
        type: 'prompt',
        text,
        outcome: OUTCOMES.includes(prompt?.outcome) ? prompt.outcome : 'pending',
        createdAt: normalizeText(prompt?.createdAt) || nowIso(),
      });
    });
  }

  if (Array.isArray(raw.notes)) {
    raw.notes.forEach((note) => {
      const content = normalizeText(note?.content);
      if (!content) {
        return;
      }

      entries.push({
        id: normalizeText(note?.id) || crypto.randomUUID(),
        type: 'note',
        text: content,
        createdAt: normalizeText(note?.updatedAt || note?.createdAt) || nowIso(),
      });
    });
  } else if (typeof raw.notes === 'string' && normalizeText(raw.notes)) {
    entries.push({
      id: crypto.randomUUID(),
      type: 'note',
      text: normalizeText(raw.notes),
      createdAt: nowIso(),
    });
  }

  return entries
    .map((entry) => normalizeEntry(entry))
    .filter(Boolean)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}

function normalizeTimeline(raw) {
  if (Array.isArray(raw.timeline) && raw.timeline.length) {
    return raw.timeline
      .map((entry) => normalizeEntry(entry))
      .filter(Boolean)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  return deriveTimelineFromLegacy(raw);
}

function ensureStateShape(raw) {
  const source = raw || {};

  state.sessionGoal = normalizeText(source.sessionGoal) || DEFAULT_GOAL;
  state.milestones = normalizeMilestones(source.milestones, source.goals);
  state.timeline = normalizeTimeline(source);
  state.sessionStartedAt = normalizeText(source.sessionStartedAt) || nowIso();
  state.preferences = {
    pinned: Boolean(source.preferences?.pinned),
    dock: source.preferences?.dock === 'left' ? 'left' : 'right',
    autoCapturePrompts: source.preferences?.autoCapturePrompts !== false,
  };
}

function applyDockClass(dock) {
  $.app.classList.toggle('left-docked', dock === 'left');
}

function renderGoal() {
  $.goalDisplay.textContent = `🎯 ${state.sessionGoal}`;
  $.goalInput.value = state.sessionGoal;

  $.goalDisplay.classList.toggle('hidden', state.isEditingGoal);
  $.goalInput.classList.toggle('hidden', !state.isEditingGoal);
}

function renderMilestones() {
  $.milestoneList.innerHTML = '';

  state.milestones.forEach((milestone) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `milestone-chip${milestone.done ? ' done' : ''}`;
    button.dataset.milestoneId = milestone.id;
    button.textContent = milestone.label;
    $.milestoneList.appendChild(button);
  });

  const completed = state.milestones.filter((milestone) => milestone.done).length;
  const total = Math.max(1, state.milestones.length);
  const progressPercent = Math.round((completed / total) * 100);

  $.progressFill.style.width = `${progressPercent}%`;
  $.progressText.textContent = `${completed}/${state.milestones.length}`;
}

function outcomeClass(outcome) {
  switch (outcome) {
    case 'implemented':
      return 'outcome-implemented';
    case 'partial':
      return 'outcome-partial';
    case 'failed':
      return 'outcome-failed';
    default:
      return 'outcome-pending';
  }
}

function renderTimeline() {
  $.timelineList.innerHTML = '';

  if (!state.timeline.length) {
    const empty = document.createElement('li');
    empty.className = 'empty-row';
    empty.textContent = 'No timeline entries yet. Log your first prompt or note.';
    $.timelineList.appendChild(empty);
    return;
  }

  state.timeline.forEach((entry) => {
    const item = document.createElement('li');
    item.className = `entry-row${entry.id === state.lastAddedEntryId ? ' new' : ''}`;

    const time = document.createElement('span');
    time.className = 'entry-time mono';
    time.textContent = formatTime(entry.createdAt);

    const type = document.createElement('span');
    type.className = `type-indicator mono ${entry.type}`;
    type.textContent = entry.type === 'prompt' ? '⟩ Prompt' : '✎ Note';

    const text = document.createElement('span');
    text.className = 'entry-text';
    text.textContent = entry.text;

    const outcome = document.createElement('span');
    if (entry.type === 'prompt') {
      outcome.className = `outcome-badge mono ${outcomeClass(entry.outcome)}`;
      outcome.textContent = entry.outcome || 'pending';
    }

    item.appendChild(time);
    item.appendChild(type);
    item.appendChild(text);
    item.appendChild(outcome);

    $.timelineList.appendChild(item);
  });
}

function renderMode() {
  const isPrompt = state.inputMode === 'prompt';

  $.modePrompt.classList.toggle('active', isPrompt);
  $.modeNote.classList.toggle('active', !isPrompt);
  $.composerInput.placeholder = isPrompt ? 'What did you ask your AI tool?' : 'Quick thought or observation...';
  $.outcomeRow.classList.toggle('hidden', !isPrompt);

  $.outcomeRow.querySelectorAll('[data-outcome]').forEach((button) => {
    button.classList.toggle('selected', button.dataset.outcome === state.selectedOutcome);
  });

  $.submitEntryBtn.textContent = isPrompt ? 'Log Prompt ↵' : 'Log Note ↵';
}

function renderTimer() {
  $.sessionTimer.textContent = formatDuration(state.sessionStartedAt);
}

function renderAll() {
  renderGoal();
  renderMilestones();
  renderTimeline();
  renderMode();
  renderTimer();
}

function pushTimelineEntryIfNew(entry) {
  const normalized = normalizeEntry(entry);
  if (!normalized) {
    return false;
  }

  const alreadyExists = state.timeline.some((item) => item.id === normalized.id);
  if (alreadyExists) {
    return false;
  }

  state.timeline.push(normalized);
  state.timeline = state.timeline
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .slice(-500);
  state.lastAddedEntryId = normalized.id;
  return true;
}

function scrollTimelineToLatest(behavior = 'auto') {
  requestAnimationFrame(() => {
    $.timelineViewport.scrollTo({ top: $.timelineViewport.scrollHeight, behavior });
  });
}

async function persistState() {
  const payload = {
    sessionGoal: state.sessionGoal,
    milestones: state.milestones,
    timeline: state.timeline.slice(-500),
    sessionStartedAt: state.sessionStartedAt,
    preferences: state.preferences,
  };

  const updated = await thoughtApi.updateState(payload);
  state.preferences = {
    pinned: Boolean(updated?.preferences?.pinned),
    dock: updated?.preferences?.dock === 'left' ? 'left' : 'right',
    autoCapturePrompts: updated?.preferences?.autoCapturePrompts !== false,
  };
  $.autoCaptureToggle.checked = state.preferences.autoCapturePrompts;
}

function startGoalEditing() {
  state.isEditingGoal = true;
  renderGoal();
  $.goalInput.focus();
  $.goalInput.select();
}

async function commitGoalEditing() {
  const nextValue = normalizeText($.goalInput.value);
  state.sessionGoal = nextValue || DEFAULT_GOAL;
  state.isEditingGoal = false;
  renderGoal();
  await persistState();
}

async function toggleMilestone(id) {
  state.milestones = state.milestones.map((milestone) => (
    milestone.id === id
      ? { ...milestone, done: !milestone.done }
      : milestone
  ));

  renderMilestones();
  await persistState();
}

async function addMilestone() {
  const label = normalizeText(window.prompt('New milestone label:'));
  if (!label) {
    return;
  }

  state.milestones.push(createMilestone(label, false));
  renderMilestones();
  await persistState();
}

async function addTimelineEntry() {
  const text = normalizeText($.composerInput.value);
  if (!text) {
    return;
  }

  const entry = {
    id: crypto.randomUUID(),
    type: state.inputMode,
    text,
    outcome: state.inputMode === 'prompt' ? state.selectedOutcome : null,
    createdAt: nowIso(),
  };

  state.timeline.push(entry);
  state.lastAddedEntryId = entry.id;

  $.composerInput.value = '';

  renderTimeline();
  scrollTimelineToLatest('smooth');
  await persistState();
}

function bindEvents() {
  window.addEventListener('mouseenter', () => thoughtApi.setHover(true));
  window.addEventListener('mouseleave', () => thoughtApi.setHover(false));

  thoughtApi.onExpandedChange((expanded) => {
    const effectiveExpanded = state.preferences.pinned ? true : expanded;
    $.app.classList.toggle('expanded', effectiveExpanded);
    $.app.classList.toggle('collapsed', !effectiveExpanded);
  });

  $.pinToggle.addEventListener('change', () => {
    state.preferences.pinned = $.pinToggle.checked;
    thoughtApi.setPinned($.pinToggle.checked);
    $.app.classList.toggle('expanded', state.preferences.pinned);
    $.app.classList.toggle('collapsed', !state.preferences.pinned);
  });

  $.autoCaptureToggle.addEventListener('change', () => {
    state.preferences.autoCapturePrompts = $.autoCaptureToggle.checked;
    persistState();
  });

  $.dockSelect.addEventListener('change', () => {
    const dock = $.dockSelect.value;
    state.preferences.dock = dock;
    applyDockClass(dock);
    thoughtApi.setDock(dock);
  });

  $.goalDisplay.addEventListener('click', startGoalEditing);

  $.goalInput.addEventListener('blur', () => {
    if (state.isEditingGoal) {
      commitGoalEditing();
    }
  });

  $.goalInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitGoalEditing();
    }

    if (event.key === 'Escape') {
      state.isEditingGoal = false;
      renderGoal();
    }
  });

  $.milestoneList.addEventListener('click', (event) => {
    const target = event.target.closest('[data-milestone-id]');
    if (!target) {
      return;
    }

    toggleMilestone(target.dataset.milestoneId);
  });

  $.addMilestoneBtn.addEventListener('click', addMilestone);

  $.modePrompt.addEventListener('click', () => {
    state.inputMode = 'prompt';
    renderMode();
    $.composerInput.focus();
  });

  $.modeNote.addEventListener('click', () => {
    state.inputMode = 'note';
    renderMode();
    $.composerInput.focus();
  });

  $.outcomeRow.addEventListener('click', (event) => {
    const target = event.target.closest('[data-outcome]');
    if (!target) {
      return;
    }

    state.selectedOutcome = target.dataset.outcome;
    renderMode();
  });

  $.composerInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      addTimelineEntry();
    }
  });

  $.submitEntryBtn.addEventListener('click', addTimelineEntry);

  thoughtApi.onAutoPromptCaptured((entry) => {
    if (!state.preferences.autoCapturePrompts) {
      return;
    }

    if (!pushTimelineEntryIfNew(entry)) {
      return;
    }

    renderTimeline();
    scrollTimelineToLatest('smooth');
  });
}

async function init() {
  const initial = await thoughtApi.getState();
  ensureStateShape(initial);

  $.pinToggle.checked = state.preferences.pinned;
  $.autoCaptureToggle.checked = state.preferences.autoCapturePrompts;
  $.dockSelect.value = state.preferences.dock;
  applyDockClass(state.preferences.dock);

  renderAll();
  scrollTimelineToLatest('auto');

  if (state.preferences.pinned) {
    $.app.classList.remove('collapsed');
    $.app.classList.add('expanded');
  }

  bindEvents();

  timerInterval = setInterval(renderTimer, 1000);
}

init();
