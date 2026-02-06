# Thought Partner (VibeGuard Sideproject)

Always-on-top side thought partner that expands on hover and stays minimal when collapsed.

## What it does now

- Multi-note workspace: create/select/delete notes with titles + tags
- Prompt session tracking: log prompts by tool + session (Codex CLI, Bash, Python, tests, etc.)
- Session memory: filter prompt history by session
- Thought/Test planning: generate workflow plans from notes + prompt history
- Prompt evolution: predict next best prompts using Groq (with heuristic fallback)

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure API key:
   ```bash
   cp .env.example .env
   # set GROQ_API_KEY in .env
   ```
3. Start app:
   ```bash
   npm start
   ```

## Prompt evolution behavior

- Uses `GROQ_API_KEY` with Groq Chat Completions for AI-driven prompt evolution.
- If Groq is unavailable, falls back to local heuristic suggestions.

## UX behavior

- Collapsed state: tiny side strip (`20px x 100px`) to avoid app obstruction
- Hover edge to expand; move away to collapse
- Always-on-top and fullscreen-space aware behavior on macOS
- `Cmd/Ctrl + Shift + Space` force-opens and pins the panel
