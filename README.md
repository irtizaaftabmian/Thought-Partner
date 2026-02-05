# 🧠 Thought Partner

**A sidekick panel that keeps you oriented while you vibecode.**

You know the feeling — you're three hours deep in a session, you've fired off 40 prompts to Claude/Cursor/Copilot, half of them worked, you pivoted twice, and now you can't remember what you were even building. Your browser tabs are chaos. Your context is gone.

Thought Partner sits on the side of your screen and quietly tracks the session for you. No complex setup, no project management overhead. Just a flight log for your flow state.

---

## What it does

**Session Goal** — Pin your "north star" at the top so you don't drift. Click to edit when you pivot. That's it.

**Milestone Chips** — Break your goal into 3-5 small tasks. Tap to check them off. A tiny progress bar keeps you honest without killing your momentum.

**Unified Timeline** — Every prompt you fire and every note you jot goes into one scrolling log with timestamps. Tag prompt outcomes as `implemented`, `partial`, `failed`, or `pending`. When you come back tomorrow, you'll know exactly where you left off.

**Bottom-Docked Input** — Always visible. Toggle between logging a prompt or dropping a quick note. Hit Enter, keep coding.

---

## Why this exists

Vibecoding is powerful but chaotic. You're thinking out loud to an AI, iterating fast, making decisions on the fly. The problem isn't the coding — it's that you lose the thread. You forget what you tried, what failed, and why you made certain choices.

Existing tools don't help because they're either too heavy (Jira, Linear) or too disconnected (a random notes app). Thought Partner is purpose-built for the loop: prompt → outcome → next move.

---

## Design philosophy

- **One panel, not three tools** — no context-switching between notes, prompt tracking, and planning
- **Log-first, not form-first** — the timeline is the product, everything else feeds into it
- **Zero friction** — if it takes more than 2 seconds to log something, you won't do it mid-flow
- **Dark, minimal, dockable** — designed to sit next to your IDE without fighting for attention

---

## Stack

- React + Tailwind
- JetBrains Mono for code/metadata, IBM Plex Sans for body
- Designed as a 360px docked sidebar
- Local-first (localStorage), no account required

---

## Roadmap

- [ ] Auto-capture prompts from clipboard / IDE extensions
- [ ] Session export (markdown dump of your full session log)
- [ ] Session replay — scrub through your timeline like a video
- [ ] AI summary — "here's what you accomplished and what's still open"
- [ ] Multi-session history with search
- [ ] VS Code / Cursor extension

---

## Getting started

```bash
git clone https://github.com/youruser/thought-partner.git
cd thought-partner
npm install
npm run dev
```

---

## Contributing

This is early. If you vibecode and wish you had something like this, open an issue or PR. Especially interested in hearing from people who use Cursor, Windsurf, or Claude Code daily.

---

Built by vibecoders, for vibecoders. 🫡
