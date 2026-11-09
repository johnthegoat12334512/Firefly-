import test from "node:test";
import assert from "node:assert/strict";
import {fakeD1} from "./fake-d1.mjs";
import worker from "../server/worker.js";
import {write, readProject, listProjects, COLLECTIONS} from "../server/store.js";

const call = (env, path, {method = "GET", body} = {}) => worker.fetch(new Request("https://f.test" + path, {method,
  headers: {authorization: "Bearer pw", "content-type": "application/json"}, body: body ? JSON.stringify(body) : undefined}), env);

test("set, update, add and delete documents", async () => {
  const db = fakeD1();
  assert.equal((await write(db, "demo", "members", {op: "set", id: "lead", data: {name: "Lead", hub: true}})).status, 200);
  assert.equal((await write(db, "demo", "members", {op: "update", id: "lead", data: {hub: false}})).status, 200);
  const added = await write(db, "demo", "chat", {op: "add", data: {text: "hi", at: "2026-11-08T00:00:00Z"}});
  const p = await readProject(db, "demo");
  assert.deepEqual(p.members[0], {id: "lead", data: {name: "Lead", hub: false}});
  assert.equal(p.chat[0].id, added.body.id);
  await write(db, "demo", "members", {op: "delete", id: "lead"});
  assert.equal((await readProject(db, "demo")).members.length, 0);
});

test("projects are kept apart and listed with their names", async () => {
  const db = fakeD1();
  await write(db, "alpha", "config", {op: "set", id: "project", data: {name: "Alpha site"}});
  await write(db, "beta", "notes", {op: "set", id: "home", data: {id: "Home", text: "# Home"}});
  assert.equal((await readProject(db, "alpha")).notes.length, 0);
  const list = await listProjects(db);
  assert.deepEqual(list.map((p) => p.id).sort(), ["alpha", "beta"]);
  assert.equal(list.find((p) => p.id === "alpha").name, "Alpha site");
});

test("rejects bad input", async () => {
  const db = fakeD1();
  assert.equal((await write(db, "Bad Name", "notes", {op: "add", data: {}})).status, 400);
  assert.equal((await write(db, "demo", "secrets", {op: "add", data: {}})).status, 400);
  assert.equal((await write(db, "demo", "notes", {op: "nuke", data: {}})).status, 400);
  assert.equal((await write(db, "demo", "notes", {op: "set", id: "../x", data: {}})).status, 400);
  assert.equal((await write(db, "demo", "notes", {op: "set", id: "a", data: [1]})).status, 400);
  assert.equal((await write(db, "demo", "notes", {op: "set", id: "a", data: {t: "x".repeat(70000)}})).status, 413);
  assert.equal((await write(db, "demo", "notes", {op: "update", id: "missing", data: {a: 1}})).status, 404);
});

test("chat keeps only the newest messages", async () => {
  const db = fakeD1(); const limit = COLLECTIONS.chat;
  for (let i = 0; i < limit + 5; i++) await write(db, "demo", "chat", {op: "add", data: {text: "m" + i, at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()}});
  const chat = (await readProject(db, "demo")).chat;
  assert.equal(chat.length, limit);
  assert.equal(chat[0].data.text, "m" + (limit + 4));
});

test("the database API needs the passcode and works through the server", async () => {
  const env = {FIREFLY_PASSCODE: "pw", DB: fakeD1()};
  const anon = await worker.fetch(new Request("https://f.test/api/db/demo"), env);
  assert.equal(anon.status, 401);
  assert.equal((await call(env, "/api/db/demo/notes", {method: "POST", body: {op: "set", id: "home", data: {id: "Home", text: "x"}}})).status, 200);
  const all = await (await call(env, "/api/db/demo")).json();
  assert.equal(all.collections.notes[0].data.text, "x");
  assert.equal((await (await call(env, "/api/projects")).json()).projects[0].id, "demo");
  assert.equal((await call(env, "/api/db/BAD!")).status, 400);
  assert.equal((await call(env, "/api/db/demo", {method: "GET"})).status, 200);
});

test("AI usage is counted in the database", async () => {
  const env = {FIREFLY_PASSCODE: "pw", DB: fakeD1(), AI: {run: async () => ({response: "ok"})}};
  for (let i = 0; i < 3; i++) await call(env, "/api/ask", {method: "POST", body: {model: "cloudflare:@cf/x", messages: [{role: "user", content: "hi"}]}});
  const s = await (await call(env, "/api/status")).json();
  assert.equal(s.usage.cloudflare.calls, 3); assert.equal(s.usageStore, "d1"); assert.equal(s.memory, true);
});

test("without a database the memory API says so instead of failing", async () => {
  assert.equal((await call({FIREFLY_PASSCODE: "pw"}, "/api/db/demo")).status, 503);
});
