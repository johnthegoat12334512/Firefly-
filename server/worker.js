/* Firefly gateway: one small Cloudflare Worker that
 *   - serves the Firefly page (the built site/ folder),
 *   - holds every AI key as a Cloudflare secret (keys never reach the browser),
 *   - sends each request to the AI it names, and if that AI has no key, is over its daily limit or fails,
 *     moves on to the next AI in the fallback list,
 *   - counts each AI's calls per day so the page can show who has allowance left.
 *
 * Routes
 *   GET  /api/health   public: {ok:true}
 *   GET  /api/status   passcode: which AIs have a key, today's usage, limits
 *   POST /api/ask      passcode: {model:"provider:model", fallback:[...], messages:[{role,content}], maxTokens}
 *                      -> {text, model, tried:[{model, error}]}
 *   anything else      the page (static files)
 *
 * Cloudflare secrets (set in the dashboard, never in code): FIREFLY_PASSCODE, ANTHROPIC_API_KEY, OPENAI_API_KEY,
 * GEMINI_API_KEY, OPENROUTER_API_KEY, DEEPSEEK_API_KEY. Free Cloudflare AI uses the AI binding (no key).
 * Optional: USAGE (a KV namespace, so counts survive restarts), DAILY_LIMITS (plain JSON, e.g. {"anthropic":200}).
 */

import {listProjects, readProject, write, addUsageRow, readUsageRows, PROJECT} from "./store.js";
import {quick, grade, quickStats} from "./quick.js";
import {makeKitchen} from "./kitchen.js";

export const PROVIDERS = {
  anthropic: {key: "ANTHROPIC_API_KEY", kind: "anthropic", base: "https://api.anthropic.com/v1"},
  openai: {key: "OPENAI_API_KEY", kind: "openai", base: "https://api.openai.com/v1"},
  gemini: {key: "GEMINI_API_KEY", kind: "openai", base: "https://generativelanguage.googleapis.com/v1beta/openai"},
  openrouter: {key: "OPENROUTER_API_KEY", kind: "openai", base: "https://openrouter.ai/api/v1"},
  deepseek: {key: "DEEPSEEK_API_KEY", kind: "openai", base: "https://api.deepseek.com/v1"},
  cloudflare: {binding: "AI", kind: "workers-ai"},
};

const MAX_TOKENS = 2000;          // cap per reply, protects your bills
const MAX_INPUT_CHARS = 60000;    // cap per request
const MAX_TRIES = 6;              // how many AIs one request may try

const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {"content-type": "application/json; charset=utf-8", "cache-control": "no-store"}});
const today = () => new Date().toISOString().slice(0, 10);

export function parseModel(id) {
  const s = String(id || ""); const i = s.indexOf(":");
  if (i < 1) return null;
  const provider = s.slice(0, i), model = s.slice(i + 1);
  return PROVIDERS[provider] && model ? {provider, model} : null;
}

export function hasProvider(env, provider) {
  const p = PROVIDERS[provider]; if (!p) return false;
  return p.binding ? !!env[p.binding] : !!env[p.key];
}

function limits(env) {
  try { const l = JSON.parse(env.DAILY_LIMITS || "{}"); return l && typeof l === "object" ? l : {}; } catch { return {}; }
}

/* Usage: one small record per day. In KV when bound, otherwise in memory (resets when Cloudflare restarts the Worker). */
const memoryUsage = new Map();
export async function readUsage(env, day = today()) {
  if (env.DB) { try { return await readUsageRows(env.DB, day); } catch { return {}; } }
  if (env.USAGE) { try { return (await env.USAGE.get("usage:" + day, "json")) || {}; } catch { return {}; } }
  return memoryUsage.get(day) || {};
}
async function addUsage(env, provider, ok, chars) {
  const day = today();
  if (env.DB) { try { await addUsageRow(env.DB, day, provider, ok, chars); } catch { /* counting must never break a reply */ } return; } const u = await readUsage(env, day);
  const row = u[provider] || {calls: 0, failed: 0, chars: 0};
  if (ok) row.calls++; else row.failed++;
  row.chars += chars; u[provider] = row;
  if (env.USAGE) { try { await env.USAGE.put("usage:" + day, JSON.stringify(u), {expirationTtl: 60 * 60 * 24 * 40}); } catch { /* counting must never break a reply */ } }
  else memoryUsage.set(day, u);
}

/* Most AIs want user/assistant turns that alternate, with the instructions split out. */
export function normalize(messages) {
  let system = ""; const out = [];
  for (const m of Array.isArray(messages) ? messages : []) {
    const role = m?.role === "assistant" ? "assistant" : m?.role === "system" ? "system" : "user";
    const content = String(m?.content ?? "");
    if (!content) continue;
    if (role === "system") { system += (system ? "\n\n" : "") + content; continue; }
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += "\n\n" + content; else out.push({role, content});
  }
  if (out[0]?.role === "assistant") out.unshift({role: "user", content: "(start)"});
  return {system, messages: out};
}

/* Cloudflare models answer in a few shapes: {response}, {result:{response}}, chat-completions, or the Responses API. */
export function replyText(r) {
  if (typeof r === "string") return r;
  const pick = r?.response ?? r?.result?.response ?? r?.choices?.[0]?.message?.content ?? r?.output_text;
  if (typeof pick === "string") return pick;
  if (Array.isArray(r?.output)) {
    const parts = r.output.filter((o) => o?.type === "message" || o?.role === "assistant").flatMap((o) => o.content || [])
      .map((c) => (typeof c === "string" ? c : c?.text)).filter((t) => typeof t === "string");
    if (parts.length) return parts.join("");
  }
  return "";
}

async function callOne(env, {provider, model}, msgs, maxTokens, fetchFn) {
  const p = PROVIDERS[provider]; const {system, messages} = normalize(msgs);
  if (p.kind === "workers-ai") {
    const r = await env[p.binding].run(model, {messages: system ? [{role: "system", content: system}, ...messages] : messages, max_tokens: maxTokens});
    const text = replyText(r);
    if (!text) throw new Error("empty reply");
    return text;
  }
  const key = env[p.key];
  if (p.kind === "anthropic") {
    const res = await fetchFn(p.base + "/messages", {method: "POST",
      headers: {"content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"},
      body: JSON.stringify({model, max_tokens: maxTokens, ...(system ? {system} : {}), messages})});
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    return (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  }
  const res = await fetchFn(p.base + "/chat/completions", {method: "POST",
    headers: {"content-type": "application/json", authorization: "Bearer " + key},
    body: JSON.stringify({model, max_tokens: maxTokens, messages: system ? [{role: "system", content: system}, ...messages] : messages})});
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== "string") throw new Error("empty reply");
  return text;
}

/* Try the asked-for AI, then each fallback, skipping any without a key or over today's limit. */
export async function ask(env, body, fetchFn = fetch) {
  const chain = [body?.model, ...(Array.isArray(body?.fallback) ? body.fallback : [])].filter(Boolean);
  const seen = new Set(); const tried = [];
  const maxTokens = Math.max(1, Math.min(MAX_TOKENS, Number(body?.maxTokens) || 1200));
  const msgs = Array.isArray(body?.messages) ? body.messages : [];
  const chars = msgs.reduce((n, m) => n + String(m?.content ?? "").length, 0);
  if (!msgs.length) return {status: 400, body: {error: "No messages."}};
  if (chars > MAX_INPUT_CHARS) return {status: 413, body: {error: "Request too long."}};
  const lim = limits(env); const used = await readUsage(env);
  for (const id of chain) {
    if (tried.length >= MAX_TRIES) break;
    if (seen.has(id)) continue; seen.add(id);
    const m = parseModel(id);
    if (!m) { tried.push({model: id, error: "unknown AI"}); continue; }
    if (!hasProvider(env, m.provider)) { tried.push({model: id, error: "no key set"}); continue; }
    const cap = Number(lim[m.provider]);
    if (Number.isFinite(cap) && (used[m.provider]?.calls || 0) >= cap) { tried.push({model: id, error: "daily limit reached"}); continue; }
    try {
      const text = await callOne(env, m, msgs, maxTokens, fetchFn);
      await addUsage(env, m.provider, true, chars + text.length);
      return {status: 200, body: {text, model: id, tried}};
    } catch (e) {
      await addUsage(env, m.provider, false, 0);
      tried.push({model: id, error: String(e?.message || e).slice(0, 120)});
    }
  }
  return {status: 502, body: {error: "No AI could answer.", tried}};
}

function sameText(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export function authorized(request, env) {
  if (!env.FIREFLY_PASSCODE) return false;           // fail closed until a passcode is set
  const h = request.headers.get("authorization") || "";
  return sameText(h.replace(/^Bearer\s+/i, ""), env.FIREFLY_PASSCODE);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") return json({ok: true});
    if (url.pathname.startsWith("/api/")) {
      if (!env.FIREFLY_PASSCODE) return json({error: "Firefly isn't set up yet: add the FIREFLY_PASSCODE secret."}, 503);
      if (!authorized(request, env)) return json({error: "Wrong or missing passcode."}, 401);
      if (url.pathname === "/api/status" && request.method === "GET") {
        const providers = Object.fromEntries(Object.keys(PROVIDERS).map((p) => [p, hasProvider(env, p)]));
        return json({ok: true, providers, usage: await readUsage(env), limits: limits(env), usageStore: env.DB ? "d1" : env.USAGE ? "kv" : "memory", memory: !!env.DB, quick: env.DB ? await quickStats(env.DB).catch(() => ({})) : {}, day: today()});
      }
      if (url.pathname === "/api/quick" && request.method === "POST") {
        let body; try { body = await request.json(); } catch { return json({error: "Bad request."}, 400); }
        const r = await quick(env, body, ask); return json(r.body, r.status);
      }
      if (url.pathname === "/api/quick/grade" && request.method === "POST") {
        let body; try { body = await request.json(); } catch { return json({error: "Bad request."}, 400); }
        const r = await grade(env, body); return json(r.body, r.status);
      }
      const om = /^\/api\/orders\/([^/]+)((?:\/[^/]+\/(?:approve|cancel))?)$/.exec(url.pathname);
      if (om) {
        if (!env.KITCHEN) return json({error: "The kitchen isn't connected yet."}, 503);
        const project = decodeURIComponent(om[1]); if (!PROJECT.test(project)) return json({error: "Bad project name."}, 400);
        const stub = env.KITCHEN.get(env.KITCHEN.idFromName(project));
        const r = await stub.fetch(new Request("https://kitchen/orders" + om[2] + "?project=" + encodeURIComponent(project), {method: request.method, headers: {"content-type": "application/json"}, body: request.method === "POST" ? await request.text() : undefined}));
        return new Response(r.body, {status: r.status, headers: {"content-type": "application/json; charset=utf-8", "cache-control": "no-store"}});
      }
      if (url.pathname === "/api/projects" && request.method === "GET") {
        if (!env.DB) return json({error: "No database connected."}, 503);
        return json({projects: await listProjects(env.DB)});
      }
      const dbm = /^\/api\/db\/([^/]+)(?:\/([^/]+))?$/.exec(url.pathname);
      if (dbm) {
        if (!env.DB) return json({error: "No database connected."}, 503);
        const project = decodeURIComponent(dbm[1]);
        if (!PROJECT.test(project)) return json({error: "Bad project name."}, 400);
        if (!dbm[2] && request.method === "GET") return json({collections: await readProject(env.DB, project)});
        if (dbm[2] && request.method === "POST") {
          let body; try { body = await request.json(); } catch { return json({error: "Bad request."}, 400); }
          const r = await write(env.DB, project, decodeURIComponent(dbm[2]), body); return json(r.body, r.status);
        }
      }
      if (url.pathname === "/api/ask" && request.method === "POST") {
        let body; try { body = await request.json(); } catch { return json({error: "Bad request."}, 400); }
        const r = await ask(env, body); return json(r.body, r.status);
      }
      return json({error: "Not found."}, 404);
    }
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Not found", {status: 404});
  },
};

/* The kitchen (one Durable Object per project) cooks orders on the server with the same AI routing as /api/ask. */
export const Kitchen = makeKitchen(ask);
