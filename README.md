# Firefly

A space where many AIs work together to build things. Free models do the easy work, paid models only get the hard
jobs, a rule-based dispatcher (JEV) hands out tasks without using any AI, and an Obsidian vault is the shared memory.

Live: https://firefly.kuzushiiweb3.workers.dev (enter the passcode in Settings > Models).

## What it does

- **One chat, a whole team.** Tell the Lead what you want. The Lead turns it into tasks; JEV sends each task to the
  right member by its word rules. Talk to any member directly too.
- **Free first.** Members on *Easy* use free models first: Llama 3.3 70B and Llama 4 Scout on Cloudflare (free daily
  allowance, no key), then Hermes 3 on OpenRouter, gpt-oss, Gemini and Hermes 2. Members on *Hard* use paid models
  first (Claude Sonnet, ChatGPT, DeepSeek, Gemini), then the free ones. If an AI has no key, is over its daily limit
  or fails, the server moves on to the next.
- **Passing a job up.** Easy members may answer `ESCALATE: <why>` instead of guessing; Firefly re-runs that job on
  Hard and labels the answer. Settings > Models shows how many of today's answers were free.
- **Memory.** Team, skills, JEV rules, notes, tasks, chat and AI usage are saved in a Cloudflare D1 database, so they
  survive reloads and show up on every device within 30 seconds.
- **Projects.** The dropdown next to the name switches projects or starts a new one. Each project has its own memory
  and starts from this repo's team and vault notes.
- **Obsidian.** Memory > *Download for Obsidian* gives a .zip vault; *Load .md files* brings edited notes back.
- **Improves itself, safely.** Memory > *Ask the team for ideas* saves three suggestions in `Improving Firefly`.
  Changes only happen through pull requests the owner approves.
- **Explore.** Ctrl/Cmd+K searches the team, notes and settings; the graph shows the team, notes and open tasks.

## How it fits together

| Part | File | What it does |
|---|---|---|
| The page | `app.html` + `brain.js` | Chat, graph, Team / Skills / JEV / Memory / Models / Tasks |
| The server | `server/worker.js` | Serves the page, holds AI keys as secrets, tries AIs in order, counts daily use |
| Memory | `server/store.js` | Per-project document store in D1, behind the passcode |
| AI list | `data/config/ai.json` | Every AI (`provider:model`) and the **easy** / **hard** tiers |
| Team | `data/members/`, `data/skills/`, `data/config/jev.json` | What a new project starts with |
| Notes | `vault/` | Obsidian vault, one `.md` per note; what a new project's memory starts with |
| Rules for AIs | `AGENTS.md` | Shared rules for Claude, ChatGPT/Codex and any other AI working here |

Two ways to open it: on Cloudflare (above), or as a Claude artifact (`index.html`, which uses your Claude plan:
Easy = Haiku, Hard = Sonnet, unless you connect the server).

## Commands

```bash
npm run build     # builds index.html (Claude copy) and site/ (Cloudflare copy)
npm test          # server, fallback, limits, passcode, memory, escalation, zip and build tests
npm run check     # build + tests + Cloudflare deploy dry-run
```

## Owner settings (Cloudflare dashboard > Workers & Pages > firefly > Settings > Variables and Secrets)

- `FIREFLY_PASSCODE` (Secret): required. Until it's set, the AI and memory stay switched off; the page still loads.
- Optional AI keys, as Secrets: `OPENROUTER_API_KEY` (free account, unlocks free OpenRouter models), `GEMINI_API_KEY`,
  `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`. Never put a key in a file in this project.
- Optional `DAILY_LIMITS` (Variable), e.g. `{"anthropic":100}`, caps paid AIs per day.

Free-plan limits: Workers 100k requests/day; D1 5M reads and 100k writes/day (one chat exchange is about 5-10
writes; the page checks for changes every 30 s while open); Workers AI has a free daily allowance and simply stops
answering when it runs out, and Firefly then moves to the next AI.

## Rules Firefly keeps

- Only the owner approves money, keys, deleting things, and changes to Firefly itself.
- Keys live only in Cloudflare secrets. Branch previews get no database, so test versions never touch real memory.
