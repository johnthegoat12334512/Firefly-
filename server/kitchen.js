/* The kitchen: you place an order ("we're making a landing page for a coffee brand"); the Lead writes tickets; JEV
 * routes each ticket to a station (a team member); tickets cook in parallel on free models (easy) or paid models
 * (hard, falling back to free); the Lead assembles one finished result. Runs on the server in a Durable Object, one
 * kitchen per project, in short steps driven by alarms, so it keeps going after the browser closes and every step
 * stays inside the free plan's limits. Anything touching money, keys, approvals or deletion is held for the owner.
 *
 *   POST /api/orders/<project>            {request, members, jev, tiers, lead}   -> {order}
 *   GET  /api/orders/<project>                                                   -> {orders:[...]} (newest first)
 *   POST /api/orders/<project>/<id>/approve  {ticket}                             -> {order}  (runs a held ticket)
 *   POST /api/orders/<project>/<id>/cancel                                        -> {order}
 */
import {write} from "./store.js";

export const LIMITS = {tickets: 12, parallel: 4, requestChars: 4000, keep: 40};
const ESCALATE = "If this ticket is beyond you (it needs careful reasoning, real code or exact numbers, or you are unsure), do not guess: reply with exactly one line, ESCALATE: <the reason in a few words>.";

const now = () => new Date().toISOString();
const shortId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const clip = (s, n) => String(s ?? "").slice(0, n);
/* "We're making a landing page for X" -> "A landing page for X" */
export function titleOf(request) {
  const first = String(request || "").split("\n")[0].replace(/^(order:|\/order)\s*/i, "")
    .replace(/^(we(?:'|’)?re|we are)\s+(making|building|creating)\s+|^let(?:'|’)?s\s+(make|build|create)\s+|^(make|build)\s+(me|us)\s+/i, "").trim();
  const t = first.charAt(0).toUpperCase() + first.slice(1);
  return clip(t || "New order", 80).replace(/[.!]+$/, "");
}
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "order";

/* JEV, server side: the same rules the page uses. Sensitive words hold a ticket for the owner. */
export function route(cfg, kind, task) {
  const jev = cfg.jev || {}, t = String(task || "").toLowerCase(), members = cfg.members || [];
  const hub = (members.find((m) => m.hub) || members[0] || {}).id || "lead";
  const hit = (jev.sensitive || []).find((w) => w && t.includes(String(w).toLowerCase()));
  if (hit) return {member: hub, held: true, why: `mentions "${hit}": held for the owner's yes`};
  const has = (id) => members.some((m) => m.id === id);
  const byKind = (jev.rules || []).find((r) => r.kind === kind && has(r.member));
  if (byKind) return {member: byKind.member, why: `kind "${kind}"`};
  let best = null, score = 0;
  for (const r of jev.rules || []) { const n = (r.words || []).filter((w) => w && t.includes(String(w).toLowerCase())).length; if (n > score && has(r.member)) { best = r; score = n; } }
  return best ? {member: best.member, why: `matched ${score} "${best.kind}" words`} : {member: hub, why: "no rule matched: the Lead takes it"};
}

/* "TICKET <kind> <easy|hard>: <task>" lines from the Lead's plan. */
export function parseTickets(text, kinds) {
  const out = [];
  for (const line of String(text || "").split("\n")) {
    const m = /^\s*[-*\d.)\s]*\**\s*TICKET\s*\**\s+([\w-]+)\s+(easy|hard)\s*\**\s*:\s*(.+)$/i.exec(line);
    if (!m) continue;
    const kind = m[1].toLowerCase();
    out.push({kind: kinds.includes(kind) ? kind : "other", size: m[2].toLowerCase(), task: clip(m[3].replace(/\*+$/, "").trim(), 400)});
    if (out.length >= LIMITS.tickets) break;
  }
  return out;
}

const persona = (cfg, id) => {
  const m = (cfg.members || []).find((x) => x.id === id) || {name: "Lead", job: "Runs the team."};
  const skills = (m.skillsText || []).map((s) => "- " + s).join("\n");
  return `You are ${m.name}, on a Firefly team. ${m.job || ""}${skills ? "\nYour skills:\n" + skills : ""}\nOnly the owner approves money, keys or rule changes. Never claim you did something you didn't. Plain English.`;
};

export class KitchenCore {
  /* store: {get(key), put(key, value), list(prefix) -> [[key, value]]}; ask(env, body) -> {status, body:{text, model}} */
  constructor(store, ask, env, project) { this.store = store; this.ask = ask; this.env = env; this.project = project; }

  async create(body) {
    const request = clip(body?.request, LIMITS.requestChars).trim();
    if (!request) return {status: 400, body: {error: "What are we making?"}};
    const cfg = {members: (body.members || []).slice(0, 30).map((m) => ({id: clip(m.id, 40), name: clip(m.name, 40), job: clip(m.job, 300), hub: !!m.hub, skillsText: (m.skillsText || []).slice(0, 6).map((s) => clip(s, 300))})),
      jev: body.jev || {}, tiers: {easy: (body.tiers?.easy || []).slice(0, 8), hard: (body.tiers?.hard || []).slice(0, 8)}};
    if (!cfg.tiers.easy.length) return {status: 400, body: {error: "No free AIs listed (tiers.easy)."}};
    if (!cfg.tiers.hard.length) cfg.tiers.hard = cfg.tiers.easy;
    const order = {id: shortId(), project: this.project, request, title: titleOf(request), status: "planning", created: now(), updated: now(), tickets: [], final: null, cfg, log: []};
    await this.save(order);
    return {status: 200, body: {order: this.view(order)}};
  }

  view(o) { const {cfg, ...rest} = o; return {...rest, tickets: o.tickets.map(({chain, ...t}) => t)}; }
  async save(o) { o.updated = now(); await this.store.put("order:" + o.id, o); }
  async list() {
    const all = (await this.store.list("order:")).map(([, v]) => v).sort((a, b) => b.created.localeCompare(a.created));
    for (const old of all.slice(LIMITS.keep)) await this.store.delete?.("order:" + old.id);
    return all.slice(0, LIMITS.keep).map((o) => this.view(o));
  }
  async load(id) { return this.store.get("order:" + id); }

  async run(chain, messages, maxTokens = 900) {
    const r = await this.ask(this.env, {model: chain[0], fallback: chain.slice(1), messages, maxTokens});
    if (r.status !== 200) throw new Error((r.body?.error || "no AI answered") + (r.body?.tried?.length ? " (" + r.body.tried.map((t) => t.error).join("; ") + ")" : ""));
    return r.body;
  }

  /* One step of work on the oldest unfinished order. Returns true while there is more to do. */
  async tick() {
    const orders = (await this.store.list("order:")).map(([, v]) => v).filter((o) => ["planning", "cooking", "assembling"].includes(o.status)).sort((a, b) => a.created.localeCompare(b.created));
    const o = orders[0]; if (!o) return false;
    try {
      if (o.status === "planning") await this.plan(o);
      else if (o.status === "cooking") await this.cook(o);
      else if (o.status === "assembling") await this.assemble(o);
    } catch (e) {
      o.failures = (o.failures || 0) + 1; o.log.push({at: now(), note: "step failed: " + clip(e?.message || e, 200)});
      if (o.failures >= 3) { o.status = "failed"; o.error = clip(e?.message || e, 300); }
      await this.save(o);
    }
    return orders.length > 1 || ["planning", "cooking", "assembling"].includes(o.status);
  }

  async plan(o) {
    const kinds = [...new Set((o.cfg.jev.rules || []).map((r) => r.kind)), "other"];
    const lead = (o.cfg.members.find((m) => m.hub) || {}).id;
    const prompt = `Order from the owner:\n${o.request}\n\nSplit this into small, independent tickets the team can cook at the same time (2 to ${LIMITS.tickets}). One line each, exactly:\nTICKET <kind> <easy|hard>: <task>\nkind is one of: ${kinds.join(", ")}. Use "hard" only for real code, careful reasoning or the most important writing; everything else is "easy". Each task must make sense on its own. Output only the TICKET lines.`;
    const r = await this.run(o.cfg.tiers.easy, [{role: "system", content: persona(o.cfg, lead)}, {role: "user", content: prompt}], 700);
    let tickets = parseTickets(r.text, kinds);
    if (!tickets.length) tickets = [{kind: "other", size: "easy", task: o.request}];
    o.tickets = tickets.map((t, i) => { const rt = route(o.cfg, t.kind, t.task);
      return {id: i + 1, ...t, member: rt.member, why: rt.why, status: rt.held ? "held" : "queued", model: null, text: null, error: null, ms: null}; });
    o.plannedBy = r.model; o.status = "cooking"; o.log.push({at: now(), note: `${o.tickets.length} tickets planned by ${r.model}`});
    await this.save(o);
  }

  async cook(o) {
    // A ticket left "cooking" by a step that never finished (the server restarted) goes back in the queue.
    for (const t of o.tickets) if (t.status === "cooking" && Date.now() - Date.parse(t.started || 0) > 180000) { t.status = "queued"; t.retries = (t.retries || 0) + 1; if (t.retries > 2) { t.status = "failed"; t.error = "kept timing out"; } }
    const ready = o.tickets.filter((t) => t.status === "queued").slice(0, LIMITS.parallel);
    if (!ready.length) {
      if (o.tickets.some((t) => t.status === "cooking")) return;   // a previous step is still on the stove
      o.status = "assembling"; await this.save(o); return;
    }
    for (const t of ready) { t.status = "cooking"; t.started = now(); }
    await this.save(o);
    await Promise.all(ready.map(async (t) => {
      const started = Date.now();
      const msgs = (extra) => [{role: "system", content: persona(o.cfg, t.member) + (extra ? "\n\n" + extra : "")},
        {role: "user", content: `The order: ${o.request}\n\nYour ticket (${t.kind}): ${t.task}\n\nDo only this ticket. Be concrete and complete; under 300 words unless the ticket needs more.`}];
      try {
        let r = await this.run(t.size === "hard" ? o.cfg.tiers.hard : o.cfg.tiers.easy, msgs(t.size === "easy" ? ESCALATE : ""));
        const up = t.size === "easy" && /^\s*\**\s*ESCALATE\b/im.test(r.text || "");
        if (up) { t.passedUp = clip(String(r.text).replace(/^[\s\S]*?ESCALATE\s*\**\s*:?\s*/i, ""), 160) || "needs a stronger model"; r = await this.run(o.cfg.tiers.hard, msgs("")); }
        t.text = clip(r.text, 12000); t.model = r.model; t.status = "done";
      } catch (e) { t.status = "failed"; t.error = clip(e?.message || e, 300); }
      t.ms = Date.now() - started;
    }));
    await this.save(o);
  }

  async assemble(o) {
    const done = o.tickets.filter((t) => t.status === "done");
    const lead = (o.cfg.members.find((m) => m.hub) || {}).id;
    if (!done.length) { o.status = "failed"; o.error = o.tickets.some((t) => t.status === "held") ? "Every ticket is waiting for your yes." : "No ticket could be cooked."; await this.save(o); return; }
    const parts = done.map((t) => `### Ticket ${t.id} (${t.kind}, ${(o.cfg.members.find((m) => m.id === t.member) || {}).name || t.member})\n${t.task}\n\n${t.text}`).join("\n\n").slice(0, 24000);
    const held = o.tickets.filter((t) => t.status === "held" || t.status === "failed");
    const prompt = `The owner's order:\n${o.request}\n\nYour team's finished tickets:\n\n${parts}\n\n${held.length ? `Not done yet (say so plainly at the end): ${held.map((t) => `ticket ${t.id}: ${t.task} [${t.status}]`).join("; ")}\n\n` : ""}Assemble one finished deliverable for the owner in Markdown: start with a one-line summary, then the result itself, ready to use. Remove repetition, fix contradictions, keep every useful detail. No talk about tickets or the team.`;
    const r = await this.run(o.cfg.tiers.hard, [{role: "system", content: persona(o.cfg, lead)}, {role: "user", content: prompt}], 1800);
    o.final = clip(r.text, 30000); o.assembledBy = r.model; o.status = "done"; o.finished = now();
    o.log.push({at: now(), note: `assembled by ${r.model}`});
    await this.save(o);
    await this.publish(o);
  }

  /* Put the result where the team already looks: a note in the vault, each ticket in Tasks, a line in the chat. */
  async publish(o) {
    const db = this.env.DB; if (!db) return;
    const at = now(), name = (id) => (o.cfg.members.find((m) => m.id === id) || {}).name || id, lead = o.cfg.members.find((m) => m.hub) || {id: "lead", name: "Lead"};
    const title = "Order: " + o.title;
    const note = `# ${title}\n\n${o.final}\n\n---\n\nOrder ${o.id} · ${o.tickets.length} tickets · planned by ${o.plannedBy}, assembled by ${o.assembledBy}\n\n` +
      o.tickets.map((t) => `- ${t.status === "done" ? "done" : t.status}: ${t.task} (${name(t.member)}${t.model ? ", " + t.model : ""}${t.passedUp ? ", passed up" : ""})`).join("\n") + "\n\nBack: [[Home]]";
    try {
      await write(db, this.project, "notes", {op: "set", id: "order-" + slug(o.title) + "-" + o.id.slice(-4), data: {id: title, text: note, at}});
      for (const t of o.tickets) await write(db, this.project, "tasks", {op: "set", id: "o" + o.id + "-" + t.id,
        data: {member: t.member, kind: t.kind, task: t.task, why: t.why, text: t.text || t.error || "", status: t.status === "done" ? "done" : t.status === "held" ? "waiting" : t.status, grade: null, order: o.id, model: t.model, at}});
      await write(db, this.project, "chat", {op: "set", id: "m-order-" + o.id, data: {from: "kitchen", to: "owner", fromLabel: "Kitchen", tag: "order done",
        text: `Ready: ${o.title}\n${o.tickets.filter((t) => t.status === "done").length} of ${o.tickets.length} tickets done. The full result is in Memory, note "${title}".\n\n` +
          o.tickets.map((t) => `${t.status === "done" ? "✓" : t.status === "held" ? "?" : "✗"} ${t.id}. ${t.task} — ${name(t.member)}`).join("\n"), at}});
    } catch (e) { o.log.push({at: now(), note: "couldn't publish: " + clip(e?.message || e, 160)}); await this.save(o); }
  }

  async approve(id, ticket) {
    const o = await this.load(id); if (!o) return {status: 404, body: {error: "No such order."}};
    const t = o.tickets.find((x) => x.id === Number(ticket)); if (!t || t.status !== "held") return {status: 400, body: {error: "That ticket isn't waiting for approval."}};
    t.status = "queued"; t.approved = now();
    if (["done", "failed"].includes(o.status)) { o.status = "cooking"; o.failures = 0; }
    await this.save(o); return {status: 200, body: {order: this.view(o)}};
  }
  async cancel(id) {
    const o = await this.load(id); if (!o) return {status: 404, body: {error: "No such order."}};
    if (!["done", "failed", "cancelled"].includes(o.status)) { o.status = "cancelled"; for (const t of o.tickets) if (["queued", "held"].includes(t.status)) t.status = "cancelled"; await this.save(o); }
    return {status: 200, body: {order: this.view(o)}};
  }
}

/* The Durable Object: one kitchen per project. Plain class (no imports), so it runs in tests too. */
export function makeKitchen(ask) {
  return class Kitchen {
    constructor(state, env) {
      this.state = state; this.env = env;
      const s = state.storage;
      this.store = {get: (k) => s.get(k), put: (k, v) => s.put(k, v), delete: (k) => s.delete(k), list: async (prefix) => [...(await s.list({prefix})).entries()]};
    }
    core(project) { return new KitchenCore(this.store, ask, this.env, project); }
    async wake() { const a = await this.state.storage.getAlarm(); if (a == null) await this.state.storage.setAlarm(Date.now() + 50); }
    async fetch(request) {
      const url = new URL(request.url), project = url.searchParams.get("project") || "firefly", k = this.core(project);
      if ((await this.state.storage.get("project")) !== project) await this.state.storage.put("project", project);
      const json = (b, status = 200) => new Response(JSON.stringify(b), {status, headers: {"content-type": "application/json"}});
      const parts = url.pathname.split("/").filter(Boolean);   // ["orders"] | ["orders", id, "approve"|"cancel"]
      if (request.method === "GET") return json({orders: await k.list()});
      const body = await request.json().catch(() => ({}));
      if (parts.length === 1) { const r = await k.create(body); if (r.status === 200) await this.wake(); return json(r.body, r.status); }
      if (parts[2] === "approve") { const r = await k.approve(parts[1], body.ticket); if (r.status === 200) await this.wake(); return json(r.body, r.status); }
      if (parts[2] === "cancel") { const r = await k.cancel(parts[1]); return json(r.body, r.status); }
      return json({error: "Not found."}, 404);
    }
    async alarm() {
      const project = (await this.state.storage.get("project")) || "firefly";
      const more = await this.core(project).tick();
      if (more) await this.state.storage.setAlarm(Date.now() + 50);
    }
  };
}
