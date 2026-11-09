import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fakeD1} from "./fake-d1.mjs";
import worker from "../server/worker.js";

// Load brain.js the way a page does (a plain script), handing it a module object to fill.
const mod = {exports: {}};
new Function("module", readFileSync(new URL("../brain.js", import.meta.url), "utf8"))(mod);
const Brain = mod.exports;
const env = () => ({FIREFLY_PASSCODE: "pw", DB: fakeD1()});
const viaWorker = (e) => (url, init = {}) => worker.fetch(new Request(url, init), e);
const open = (e, project = "demo") => Brain.store({url: "https://f.test", passcode: "pw", project, fetch: viaWorker(e)});

test("what one page writes, another page reads", async () => {
  const e = env(); const a = open(e), b = open(e);
  await a.collection("members").doc("lead").set({name: "Lead", hub: true, at: "1"});
  await a.collection("members").doc("lead").update({job: "runs things"});
  const {id} = await a.collection("chat").add({text: "hello", at: "2026"});
  const m = await b.collection("members").get();
  assert.deepEqual(m.docs[0].data(), {name: "Lead", hub: true, at: "1", job: "runs things"});
  const c = await b.collection("chat").orderBy("at", "desc").limit(5).get();
  assert.equal(c.docs[0].id, id);
});

test("listeners hear about changes at once, in the right order", async () => {
  const e = env(); const a = open(e); const seen = [];
  await a.ready();
  a.collection("tasks").orderBy("at", "desc").onSnapshot((s) => seen.push(s.docs.map((d) => d.data().t).join(",")));
  await a.collection("tasks").add({t: "one", at: "2026-01-01"});
  await a.collection("tasks").add({t: "two", at: "2026-01-02"});
  assert.equal(seen.at(-1), "two,one");
});

test("deletes reach the server", async () => {
  const e = env(); const a = open(e);
  await a.collection("notes").doc("home").set({id: "Home", text: "x"});
  await a.collection("notes").doc("home").delete();
  assert.equal((await open(e).collection("notes").get()).size, 0);
});

test("a wrong passcode is reported, not hidden", async () => {
  const e = env(); const bad = Brain.store({url: "https://f.test", passcode: "nope", project: "demo", fetch: viaWorker(e)});
  await assert.rejects(bad.ready(), (x) => x.status === 401);
});

test("many quick writes all arrive", async () => {
  const e = env(); const a = open(e);
  await Promise.all(Array.from({length: 20}, (_, i) => a.collection("chat").add({text: "m" + i, at: String(1000 + i)})));
  assert.equal((await open(e).collection("chat").get()).size, 20);
});

test("a poll with nothing new doesn't redraw (so half-typed forms survive)", async () => {
  const e = env(); const a = open(e); await a.collection("notes").doc("home").set({id: "Home", text: "x"});
  const b = open(e); let calls = 0;
  b.collection("notes").onSnapshot(() => calls++);
  await b.ready(); await new Promise((r) => setTimeout(r, 10)); const first = calls;
  await b.refresh(); await b.refresh();
  assert.equal(calls, first, "no redraw when nothing changed");
  await a.collection("notes").doc("home").set({id: "Home", text: "changed"});
  await b.refresh();
  assert.equal(calls, first + 1, "one redraw when something changed");
});
