/* The quick lane: simple questions answered for free.
 *   1. no AI at all (quick-rules.js),
 *   2. a remembered answer from an earlier free model reply,
 *   3. a free model only. The server refuses paid AIs here, whatever keys are set.
 * A free model can hand the question back ("ESCALATE"); then the page gives it to the team as usual.
 *
 * Every answer is kept in quick_answers (question, answer, which model, hand-backs, later a grade): today it's the
 * cache, later it's training data for growing models on Firefly.
 *
 *   POST /api/quick {question, members?:[{name}], lead?, freeChain?:[...]} -> {answered, text?, source?, model?}
 */
import {instant, looksSimple, isHandBack, normalize, QUICK_PROMPT} from "./quick-rules.js";

export const DEFAULT_FREE = ["cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast", "cloudflare:@cf/meta/llama-4-scout-17b-16e-instruct"];
export const isFree = (id) => /^cloudflare:/.test(id || "") || /^openrouter:.+:free$/.test(id || "");
const KEEP_DAYS = 30;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS quick_answers (q TEXT PRIMARY KEY, question TEXT NOT NULL, answer TEXT, model TEXT, handed_back INTEGER NOT NULL DEFAULT 0, hits INTEGER NOT NULL DEFAULT 0, good INTEGER, at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS quick_stats (day TEXT NOT NULL, source TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, source))",
];
const ready = new WeakSet();
async function schema(db) { if (ready.has(db)) return; for (const s of SCHEMA) await db.prepare(s).run(); ready.add(db); }
const day = () => new Date().toISOString().slice(0, 10);
async function count(db, source) {
  if (!db) return;
  try { await schema(db); await db.prepare("INSERT INTO quick_stats (day, source, n) VALUES (?, ?, 1) ON CONFLICT (day, source) DO UPDATE SET n = n + 1").bind(day(), source).run(); } catch { /* stats never block an answer */ }
}
export async function quickStats(db, d = day()) {
  if (!db) return {};
  await schema(db);
  const {results} = await db.prepare("SELECT source, n FROM quick_stats WHERE day = ?").bind(d).all();
  return Object.fromEntries((results || []).map((r) => [r.source, r.n]));
}

export async function quick(env, body, askFn) {
  const question = String(body?.question || "").slice(0, 400);
  if (!question.trim()) return {status: 400, body: {error: "No question."}};
  const ctx = {members: Array.isArray(body?.members) ? body.members.slice(0, 30) : [], lead: body?.lead};
  const rule = instant(question, ctx);
  if (rule) { await count(env.DB, "instant"); return {status: 200, body: {answered: true, text: rule, source: "instant"}}; }
  if (!looksSimple(question)) return {status: 200, body: {answered: false, reason: "not a quick question"}};
  const key = normalize(question);
  if (env.DB) {
    try {
      await schema(env.DB);
      const hit = await env.DB.prepare("SELECT answer, model, handed_back, good, at FROM quick_answers WHERE q = ?").bind(key).first();
      const fresh = hit && Date.now() - Date.parse(hit.at) < KEEP_DAYS * 864e5;
      if (fresh && hit.handed_back) { await count(env.DB, "handed-back"); return {status: 200, body: {answered: false, reason: "free models handed this back before"}}; }
      if (fresh && hit.answer && hit.good !== 0) {
        await env.DB.prepare("UPDATE quick_answers SET hits = hits + 1 WHERE q = ?").bind(key).run();
        await count(env.DB, "remembered");
        return {status: 200, body: {answered: true, text: hit.answer, source: "remembered", model: hit.model}};
      }
    } catch { /* fall through to a free model */ }
  }
  const chain = (Array.isArray(body?.freeChain) && body.freeChain.length ? body.freeChain : DEFAULT_FREE).filter(isFree);
  if (!chain.length) return {status: 200, body: {answered: false, reason: "no free AI listed"}};
  const r = await askFn(env, {model: chain[0], fallback: chain.slice(1), maxTokens: 300,
    messages: [{role: "system", content: QUICK_PROMPT}, {role: "user", content: question}]});
  if (r.status !== 200) return {status: 200, body: {answered: false, reason: "free AIs unavailable", tried: r.body?.tried}};
  const text = String(r.body.text || "").trim(), back = isHandBack(text);
  if (env.DB) {
    try {
      await env.DB.prepare("INSERT INTO quick_answers (q, question, answer, model, handed_back, hits, at) VALUES (?, ?, ?, ?, ?, 0, ?) ON CONFLICT (q) DO UPDATE SET answer = excluded.answer, model = excluded.model, handed_back = excluded.handed_back, good = NULL, at = excluded.at")
        .bind(key, question, back ? null : text, r.body.model, back ? 1 : 0, new Date().toISOString()).run();
    } catch { /* the answer still goes back */ }
  }
  await count(env.DB, back ? "handed-back" : "free-model");
  return {status: 200, body: back ? {answered: false, reason: "the free AI handed it to the team"} : {answered: true, text, source: "free-model", model: r.body.model}};
}

/* Mark a remembered answer good or bad. A bad one is never served again and is kept as a training example. */
export async function grade(env, body) {
  if (!env.DB) return {status: 503, body: {error: "No database connected."}};
  const key = normalize(body?.question); if (!key) return {status: 400, body: {error: "No question."}};
  await schema(env.DB);
  const r = await env.DB.prepare("UPDATE quick_answers SET good = ? WHERE q = ?").bind(body?.good ? 1 : 0, key).run();
  return r?.meta?.changes ? {status: 200, body: {ok: true}} : {status: 404, body: {error: "No such answer."}};
}
