# Thought Partner (VibeGuard Sideproject)

A docked Electron sidekick panel that keeps your vibecoding session organized in one place.

## What it does

- Pinned session goal at the top (editable "north star")
- Milestone chips with done/undone state and progress tracking
- Unified timeline for prompts and notes with timestamps
- Prompt outcomes: `implemented`, `partial`, `failed`, `pending`
- Bottom-docked composer for fast prompt/note logging
- Auto prompt capture from clipboard (toggleable)
- Always-on-top side panel with compact collapsed hover strip

## Stack

- Electron
- Vanilla HTML/CSS/JS renderer
- Local-first persistence (JSON state in app data)
- Optional Groq integration for prompt evolution suggestions

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure environment:
   ```bash
   cp .env.example .env
   # set GROQ_API_KEY in .env
   ```
3. Start app:
   ```bash
   npm start
   ```

## UX behavior

- 360px expanded side panel, full viewport height
- Tiny collapsed strip to avoid blocking other apps
- Hover edge to expand and move away to collapse
- Pin mode keeps panel open
- `Cmd/Ctrl + Shift + Space` force-opens and pins the panel

## Notes

- Auto-capture listens to clipboard changes and logs prompt-like text.
- `.env` and `node_modules` are excluded from git.
