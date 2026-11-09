# AI allowance

How members pick an AI (Settings > Team > Thinks with):

| Choice | What happens |
|---|---|
| Easy (free first) | Llama 3.3 and Llama 4 on Cloudflare (free, no key), then Hermes 3 on OpenRouter, gpt-oss, Gemini, and Hermes 2 on Cloudflare |
| Hard (paid first) | Claude Sonnet, then ChatGPT, DeepSeek, Gemini; if none answer, the free models |
| One named AI | That AI, then the free backups |
| Claude Haiku / Sonnet / Opus | Your own Claude plan when Firefly is opened inside Claude |

**Passing a job up.** Easy members are told they may reply `ESCALATE: <why>` instead of guessing. Firefly then quietly re-runs that job on the Hard level and shows "(Passed up to Hard: why)" above the answer. Easy jobs stay free; hard jobs still get done properly.

If an AI has no key, is over its daily limit or fails, the server moves to the next one. Settings > Models shows each AI's use today and how many answers came from free AIs.

Back: [[Firefly]]

## Quick answers (free, before the team spends anything)

Messages to the Lead first try the quick lane:

1. **No AI at all:** greetings, thanks, "what can you do", the time and date, maths ("15% of 240").
2. **Remembered:** a simple question a free model already answered well is answered again from memory.
3. **Free model only:** other short, general questions go to a free Cloudflare model. The server refuses paid AIs here, whatever keys are set.
4. **Everything else** (real work, your own project, live prices or news) goes straight to the team.

Not good enough? Ask the same thing again right away: the quick answer is marked bad, never reused, and the team takes it.
Every quick answer is kept with the model that gave it and whether it was good: the start of Firefly's own training data.

Back: [[Firefly]]

## Orders: the kitchen

Say **"we're making …"**, **"let's build …"** or **"order: …"** and the order goes to the kitchen on the server:

1. The Lead (free model) writes up to 12 tickets, each easy or hard.
2. JEV sends each ticket to a station. Anything about money, keys, approvals or deleting is **held** until you reply `approve <number>`.
3. Tickets cook four at a time: easy ones on free models, hard ones on paid models (free if no paid key). A free worker can pass its ticket up.
4. The Lead assembles one finished result, saved in Memory as "Order: …", with every ticket in Tasks for grading.

It runs on Cloudflare, not in your browser: close the tab and the order keeps cooking.

Back: [[Firefly]]
