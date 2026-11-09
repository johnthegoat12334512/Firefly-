# Rules for every AI working on Firefly (Claude, ChatGPT/Codex, Gemini, anyone)

The owner is not a developer: write summaries in plain language.

## Before you start
- Read `README.md` and `vault/Firefly.md`.
- Pull the latest `main` first. Work on your own branch named after you, e.g. `chatgpt/<topic>` or `claude/<topic>`.
  Never push straight to `main` and never force-push or rewrite history.
- Check open pull requests so two AIs don't build the same thing. If one exists, comment there instead.

## While you work
- Small changes, one topic per pull request.
- Edit `app.html` and `brain.js`, never `index.html` or `site/` by hand: those are built by `npm run build`.
- Team notes live in `vault/` as Obsidian markdown; keep `[[links]]` working.
- New AIs go in `data/config/ai.json` as `provider:model`. Mark a name `check: true` unless you confirmed it.
- Free first: easy work on free models, paid models only for hard jobs.

## Before you open a pull request
- Run `npm run check` (build, tests, Cloudflare dry-run). All must pass. Add tests for new server behaviour.
- Commit the rebuilt `index.html` and `site/`.
- In the pull request, say in plain words what changed, how you tested it, and anything the owner must click.

## Never
- Put an API key, password or passcode in any file. Keys are Cloudflare secrets only.
- Merge your own pull request. The owner approves every merge.
- Spend money, sign up for paid services, or send any blockchain transaction.
- Change how the passcode check works without tests proving the API still refuses strangers.
