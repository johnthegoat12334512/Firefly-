/* Quick rules: answers that need no AI at all, and a test for "is this a simple question a free model can take?".
 * Shared by the server (imported) and the page (inlined by scripts/build.mjs), so the page can answer greetings, maths
 * and the time instantly without even calling the server. Pure functions, no dependencies. */

export function normalize(text) {
  return String(text || "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim().replace(/[\s?!.]+$/, "");
}

/* ---- safe arithmetic: numbers, + - * / % ^ ( ), "x% of y". No eval. ---- */
function tokens(src) {
  const out = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " ") { i++; continue; }
    const num = /^(\d+(?:\.\d+)?|\.\d+)/.exec(src.slice(i));
    if (num) { out.push({n: parseFloat(num[1])}); i += num[1].length; continue; }
    if ("+-*/^()".includes(c)) { out.push({op: c}); i++; continue; }
    return null;
  }
  return out;
}
export function calculate(expr) {
  let src = String(expr || "").toLowerCase().replace(/,(?=\d{3})/g, "").replace(/×|x(?=\s*[\d(])/g, "*").replace(/÷/g, "/").replace(/\*\*/g, "^")
    .replace(/\bplus\b/g, "+").replace(/\bminus\b/g, "-").replace(/\b(times|multiplied by)\b/g, "*").replace(/\bdivided by\b/g, "/").trim();
  const pct = /^(\d+(?:\.\d+)?)\s*%\s*of\s*(\d+(?:\.\d+)?)$/.exec(src);
  if (pct) return tidy(parseFloat(pct[1]) / 100 * parseFloat(pct[2]));
  if (src.length > 80 || !/\d/.test(src) || !/[+\-*/^]/.test(src.replace(/^-/, ""))) return null;
  const t = tokens(src); if (!t || !t.length) return null;
  let p = 0;
  const peek = () => t[p], take = () => t[p++];
  function primary() {
    const k = take(); if (!k) throw 0;
    if (k.n != null) return k.n;
    if (k.op === "-") return -primary();
    if (k.op === "+") return primary();
    if (k.op === "(") { const v = sum(); if (take()?.op !== ")") throw 0; return v; }
    throw 0;
  }
  function power() { const b = primary(); if (peek()?.op === "^") { take(); return Math.pow(b, power()); } return b; }
  function product() { let v = power(); while (peek() && "*/".includes(peek().op)) { const o = take().op, r = power(); if (o === "/" && r === 0) throw 0; v = o === "*" ? v * r : v / r; } return v; }
  function sum() { let v = product(); while (peek() && "+-".includes(peek().op)) { const o = take().op, r = product(); v = o === "+" ? v + r : v - r; } return v; }
  try { const v = sum(); if (p !== t.length || !Number.isFinite(v)) return null; return tidy(v); } catch { return null; }
}
function tidy(v) { if (!Number.isFinite(v)) return null; const r = Math.round(v * 1e10) / 1e10; return Math.abs(r) >= 1e15 ? r.toExponential(6) : String(r); }

/* ---- answers that need no AI ---- */
const pick = (list, seed) => list[Math.abs(seed) % list.length];
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);

/* ctx: {members:[{name, job}], now: Date, lead: "Lead", local: true when run in the page (local time is known)} */
export function instant(text, ctx = {}) {
  const q = normalize(text); if (!q || q.length > 160) return null;
  const now = ctx.now || new Date(), h = hash(q);
  if (/^(hi|hey|hello|hiya|yo|sup|howdy|gm|good (morning|afternoon|evening)|hey there|hi there|hello there)( (team|everyone|all|firefly|guys))?$/.test(q))
    return pick(["Hi! What are we working on?", "Hey. What do you want to get done?", "Hello! Tell me what you need and I'll get the team on it."], h);
  if (/^(thanks|thank you|thx|ty|cheers|thanks a lot|thank you so much|appreciate it|much appreciated)( (team|everyone|all|lead))?$/.test(q))
    return pick(["You're welcome.", "Any time.", "Happy to help."], h);
  if (/^(ok|okay|k|cool|nice|great|perfect|awesome|got it|sounds good|alright|lol|haha)$/.test(q)) return "Got it.";
  if (/^(bye|goodbye|good night|gn|see you|see ya|later|cya)$/.test(q)) return "See you. Everything's saved for next time.";
  if (/^(how are you|how're you|how are you doing|how's it going|what's up|whats up|wassup)$/.test(q)) return "All good and ready to work. What's next?";
  if (/^(are you there|you there|anyone there|hello\?*)$/.test(q)) return "Yes, here. What do you need?";
  if (/^(who are you|what are you|what is this|what's this|what is firefly|what's firefly|what can you do|what do you do|help|what can i ask|how does this work|how do i use this)$/.test(q)) {
    const team = (ctx.members || []).map((m) => m.name).filter(Boolean);
    return `This is Firefly: a team of AIs working together. You talk to the ${ctx.lead || "Lead"}, who splits your request into tasks and hands them out${team.length ? ` to ${team.join(", ")}` : ""}. Simple questions get a quick free answer; real work goes to the team. Try "write a launch tweet" or "research three competitors".`;
  }
  if (/^(what time is it|what's the time|whats the time|time|current time|what time is it now|tell me the time)$/.test(q)) {
    const t = ctx.local ? now.toLocaleTimeString([], {hour: "numeric", minute: "2-digit"}) : now.toISOString().slice(11, 16) + " UTC";
    return `It's ${t}.`;
  }
  if (/^(what's the date|whats the date|what is the date|what day is it|what's today's date|today's date|what is today|date|what's today|what day is today)$/.test(q)) {
    const d = ctx.local ? now.toLocaleDateString([], {weekday: "long", year: "numeric", month: "long", day: "numeric"}) : now.toISOString().slice(0, 10) + " (UTC)";
    return `Today is ${d}.`;
  }
  const math = /^(?:what(?:'s| is)|whats|calculate|calc|compute|solve|how much is|=)?\s*(.+?)(?:\s*=)?$/.exec(q);
  if (math) { const v = calculate(math[1]); if (v != null) return `${math[1].replace(/\s+/g, " ")} = ${v}`; }
  return null;
}

/* ---- is this a short, general question a free model can answer on its own? ---- */
const WORK = /\b(build|make|create|write|draft|design|code|program|fix|debug|deploy|implement|plan|research|analy[sz]e|compare|review|critique|summari[sz]e|translate|generate|launch|edit|rewrite|improve|optimi[sz]e|set ?up|configure|refactor|test|audit|strategy|list of|step by step)\b/;
const PERSONAL = /\b(my|our|we|us|i've|i have|this project|the project|the team|you guys|firefly's|notes?|tasks?|vault)\b/;
const LIVE = /\b(today|tonight|now|current(ly)?|latest|newest|recent|this (week|month|year)|price|prices|cost of|weather|news|stock|score|who won|trending|live)\b/;
const MONEY = /\b(money|pay|spend|budget|password|api key|private key|seed phrase|wallet|invest|buy|sell)\b/;
export function looksSimple(text) {
  const q = normalize(text);
  if (q.length < 3 || q.length > 220 || q.split(" ").length > 40) return false;
  if (/\n/.test(String(text).trim())) return false;
  if (WORK.test(q) || PERSONAL.test(q) || LIVE.test(q) || MONEY.test(q)) return false;
  const questiony = /\?\s*$/.test(String(text).trim()) || /^(what|who|when|where|why|how|which|is|are|was|were|do|does|did|can|could|should|would|will|define|meaning of|explain|tell me|whats|what's|who's|how's|difference between)\b/.test(q);
  return questiony;
}

/* A free model's reply that hands the question back ("ESCALATE ...") means: give it to the team instead. */
export function isHandBack(text) {
  return /^\s*\**\s*ESCALATE\b/i.test(String(text || "")) || !String(text || "").trim();
}

export const QUICK_PROMPT = "You are Firefly's quick helper. Answer the question in at most three short sentences of plain English, no preamble. If it needs real work (building, long writing, research, planning, anything about the user's own project), current information, or you are not sure, reply with exactly: ESCALATE";
