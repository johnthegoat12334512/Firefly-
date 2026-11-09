import test from "node:test";
import assert from "node:assert/strict";
import {fakeD1} from "./fake-d1.mjs";
import worker, {Kitchen} from "../server/worker.js";
import {parseTickets, route, LIMITS} from "../server/kitchen.js";
import {readProject} from "../server/store.js";

const JEV = {sensitive: ["money", "wallet", "api key"], rules: [
  {kind: "research", member: "researcher", words: ["research", "find"]}, {kind: "build", member: "builder", words: ["build", "code"]},
  {kind: "write", member: "writer", words: ["write", "copy"]}]};
const MEMBERS = [{id: "lead", name: "Lead", hub: true, job: "Runs the team."}, {id: "researcher", name: "Researcher"}, {id: "builder", name: "Builder"}, {id: "writer", name: "Writer"}];
const TIERS = {easy: ["cloudflare:@cf/free-a", "cloudflare:@cf/free-b"], hard: ["anthropic:claude-sonnet-5-5", "cloudflare:@cf/free-a"]};

/* A fake Durable Object runtime: storage with alarms, and namespaces that hand back one instance per name. */
function fakeState() {
  const data = new Map(); let alarm = null;
  return {storage: {get: async (k) => structuredClone(data.get(k)), put: async (k, v) => { data.set(k, structuredClone(v)); }, delete: async (k) => data.delete(k),
    list: async ({prefix}) => new Map([...data].filter(([k]) => k.startsWith(prefix)).map(([k, v]) => [k, structuredClone(v)])),
    getAlarm: async () => alarm, setAlarm: async (t) => { alarm = t; }}, alarmAt: () => alarm, clearAlarm: () => { alarm = null; }};
}
function kitchenEnv(aiReply) {
  const states = new Map(), instances = new Map(), live = {now: 0, max: 0, calls: []};
  const env = {FIREFLY_PASSCODE: "pw", DB: fakeD1(),
    AI: {run: async (model, input) => { live.now++; live.max = Math.max(live.max, live.now); live.calls.push({model, input});
      await new Promise((r) => setTimeout(r, 5)); try { return {response: aiReply(model, input)}; } finally { live.now--; } }}};
  env.KITCHEN = {idFromName: (n) => n, get: (id) => { if (!instances.has(id)) { const st = fakeState(); states.set(id, st); instances.set(id, new Kitchen(st, env)); } return instances.get(id); }};
  const runAlarms = async (project, max = 50) => { const st = states.get(project), k = instances.get(project); let n = 0;
    while (st.alarmAt() != null && n++ < max) { st.clearAlarm(); await k.alarm(); } return n; };
  return {env, live, runAlarms};
}
const call = (env, path, body) => worker.fetch(new Request("https://f.test" + path, {method: body ? "POST" : "GET",
  headers: {authorization: "Bearer pw", "content-type": "application/json"}, body: body ? JSON.stringify(body) : undefined}), env);
const order = (env, request) => call(env, "/api/orders/demo", {request, members: MEMBERS, jev: JEV, tiers: TIERS});

function chef(model, input) {
  const sys = input.messages[0].content, user = input.messages.at(-1).content;
  if (user.includes("Split this into small")) return ["TICKET research easy: find three competitor coffee sites", "TICKET write easy: write the homepage copy",
    "TICKET build hard: code the landing page HTML", "TICKET write easy: write the about-us copy", "TICKET write easy: draft the newsletter signup copy",
    "TICKET other easy: set the monthly ad budget and spend money on ads"].join("\n");
  if (user.includes("Assemble one finished deliverable")) return "Coffee landing page, ready.\n\n# Bean There\nAll the parts, combined.";
  if (user.includes("about-us") && sys.includes("ESCALATE")) return "ESCALATE: needs the brand story";
  return `Done: ${user.split("Your ticket")[1]?.slice(0, 40)} [${model}]`;
}

test("TICKET lines are read, capped, and unknown kinds become 'other'", () => {
  const t = parseTickets("intro\nTICKET write easy: a\n- **TICKET** build HARD: b\nTICKET dance easy: c\nnot a ticket", ["write", "build", "other"]);
  assert.deepEqual(t.map((x) => [x.kind, x.size, x.task]), [["write", "easy", "a"], ["build", "hard", "b"], ["other", "easy", "c"]]);
  assert.equal(parseTickets(Array(30).fill("TICKET write easy: x").join("\n"), ["write"]).length, LIMITS.tickets);
});

test("JEV routing on the server matches the page, and holds anything sensitive", () => {
  const cfg = {jev: JEV, members: MEMBERS};
  assert.equal(route(cfg, "research", "find rivals").member, "researcher");
  assert.equal(route(cfg, "other", "build the code").member, "builder");
  assert.equal(route(cfg, "other", "something vague").member, "lead");
  const h = route(cfg, "write", "write copy about our wallet"); assert.equal(h.held, true); assert.equal(h.member, "lead");
});

test("an order goes from request to finished result, in parallel, on the server", async () => {
  const {env, live, runAlarms} = kitchenEnv(chef);
  const r = await (await order(env, "We're making a landing page for a coffee brand")).json();
  assert.equal(r.order.status, "planning"); assert.ok(!("cfg" in r.order), "settings stay on the server");
  await runAlarms("demo");
  const o = (await (await call(env, "/api/orders/demo")).json()).orders[0];
  assert.equal(o.status, "done", JSON.stringify(o.log));
  assert.equal(o.tickets.length, 6);
  const by = Object.fromEntries(o.tickets.map((t) => [t.task.split(" ").slice(0, 3).join(" "), t]));
  assert.equal(by["find three competitor"].member, "researcher");
  assert.equal(by["code the landing"].size, "hard");
  assert.equal(by["set the monthly"].status, "held", "money ticket waits for the owner");
  assert.ok(by["write the about-us"].passedUp, "a free worker passed its ticket up");
  assert.match(o.final, /Bean There/);
  assert.ok(live.max > 1 && live.max <= LIMITS.parallel, `cooked in parallel (max ${live.max} at once)`);
  assert.ok(live.calls.every((c) => !/claude/.test(c.model)), "no paid AI used without a key");
  const p = await readProject(env.DB, "demo");
  assert.ok(p.notes.some((n) => n.data.id.startsWith("Order: A landing page for a coffee brand")), "result saved as a vault note");
  assert.equal(p.tasks.length, 6, "every ticket in Tasks");
  assert.ok(p.chat.some((m) => m.id === "m-order-" + o.id && /^Ready: /.test(m.data.text)), "one chat message per order, saying it is ready");
});

test("a held ticket runs only after the owner approves it, then the order is assembled again", async () => {
  const {env, live, runAlarms} = kitchenEnv(chef);
  const id = (await (await order(env, "Coffee site")).json()).order.id;
  await runAlarms("demo");
  const before = live.calls.length;
  const held = (await (await call(env, "/api/orders/demo")).json()).orders[0].tickets.find((t) => t.status === "held");
  const cookedIt = (c) => /Your ticket[^\n]*spend money on ads/.test(c.input.messages.at(-1).content);
  assert.ok(!live.calls.some(cookedIt), "never cooked before approval");
  const a = await call(env, `/api/orders/demo/${id}/approve`, {ticket: held.id}); assert.equal(a.status, 200);
  await runAlarms("demo");
  const o = (await (await call(env, "/api/orders/demo")).json()).orders[0];
  assert.equal(o.tickets.find((t) => t.id === held.id).status, "done"); assert.equal(o.status, "done");
  assert.ok(live.calls.length > before); assert.ok(live.calls.some(cookedIt), "cooked after approval");
  assert.equal((await call(env, `/api/orders/demo/${id}/approve`, {ticket: 1})).status, 400, "only held tickets can be approved");
});

test("cancel stops an order before it cooks", async () => {
  const {env, live, runAlarms} = kitchenEnv(chef);
  const id = (await (await order(env, "Coffee site")).json()).order.id;
  await call(env, `/api/orders/demo/${id}/cancel`, {});
  await runAlarms("demo");
  assert.equal(live.calls.length, 0);
  assert.equal((await (await call(env, "/api/orders/demo")).json()).orders[0].status, "cancelled");
});

test("when no AI can answer, the order fails cleanly after three tries instead of looping", async () => {
  const {env, runAlarms} = kitchenEnv(() => { throw new Error("capacity"); });
  await order(env, "Coffee site");
  const steps = await runAlarms("demo");
  const o = (await (await call(env, "/api/orders/demo")).json()).orders[0];
  assert.equal(o.status, "failed"); assert.ok(steps <= 4, `stopped after ${steps} steps`);
});

test("orders need the passcode, a request and free AIs", async () => {
  const {env} = kitchenEnv(chef);
  assert.equal((await worker.fetch(new Request("https://f.test/api/orders/demo"), env)).status, 401);
  assert.equal((await call(env, "/api/orders/demo", {request: "  ", tiers: TIERS})).status, 400);
  assert.equal((await call(env, "/api/orders/demo", {request: "x", tiers: {easy: []}})).status, 400);
  assert.equal((await call(env, "/api/orders/BAD!", {request: "x", tiers: TIERS})).status, 400);
  assert.equal((await call({FIREFLY_PASSCODE: "pw"}, "/api/orders/demo")).status, 503);
});

test("each project has its own kitchen", async () => {
  const {env, runAlarms} = kitchenEnv(chef);
  await order(env, "Coffee site");
  await call(env, "/api/orders/other", {request: "Tea site", members: MEMBERS, jev: JEV, tiers: TIERS});
  await runAlarms("demo"); await runAlarms("other");
  const a = (await (await call(env, "/api/orders/demo")).json()).orders, b = (await (await call(env, "/api/orders/other")).json()).orders;
  assert.equal(a.length, 1); assert.equal(b.length, 1); assert.equal(b[0].request, "Tea site");
});

test("order titles drop the 'we're making' part", async () => {
  const {titleOf} = await import("../server/kitchen.js");
  assert.equal(titleOf("We're making a landing page for Bean There."), "A landing page for Bean There");
  assert.equal(titleOf("let's build a todo app"), "A todo app");
  assert.equal(titleOf("order: logo ideas"), "Logo ideas");
  assert.equal(titleOf("make me a poem\nmore detail"), "A poem");
});
