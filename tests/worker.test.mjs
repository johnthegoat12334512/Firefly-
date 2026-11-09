import test from "node:test";
import assert from "node:assert/strict";
import worker, {ask, parseModel, normalize} from "../server/worker.js";

const msgs = [{role: "user", content: "You are the Lead."}, {role: "assistant", content: "Understood."}, {role: "user", content: "Hi"}];
const okOpenAI = (text) => async () => new Response(JSON.stringify({choices: [{message: {content: text}}]}), {status: 200});
const req = (path, {method = "GET", pass, body} = {}) => new Request("https://firefly.test" + path, {method,
  headers: {...(pass ? {authorization: "Bearer " + pass} : {}), "content-type": "application/json"}, body: body ? JSON.stringify(body) : undefined});

test("parseModel understands provider:model and rejects the rest", () => {
  assert.deepEqual(parseModel("openrouter:meta/llama:free"), {provider: "openrouter", model: "meta/llama:free"});
  assert.equal(parseModel("claude-haiku-5-5"), null);
  assert.equal(parseModel("nope:x"), null);
});

test("normalize merges repeated turns and pulls out system text", () => {
  const n = normalize([{role: "system", content: "S"}, {role: "assistant", content: "a"}, {role: "user", content: "b"}, {role: "user", content: "c"}]);
  assert.equal(n.system, "S");
  assert.deepEqual(n.messages.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(n.messages[2].content, "b\n\nc");
});

test("asks the named AI when it has a key", async () => {
  const r = await ask({GEMINI_API_KEY: "k"}, {model: "gemini:g-1", messages: msgs}, okOpenAI("hello"));
  assert.equal(r.status, 200); assert.equal(r.body.text, "hello"); assert.equal(r.body.model, "gemini:g-1");
});

test("skips AIs with no key and falls back to the next", async () => {
  const r = await ask({OPENROUTER_API_KEY: "k"}, {model: "anthropic:claude-haiku-5-5", fallback: ["openrouter:free-model"], messages: msgs}, okOpenAI("from fallback"));
  assert.equal(r.status, 200); assert.equal(r.body.model, "openrouter:free-model");
  assert.equal(r.body.tried[0].error, "no key set");
});

test("falls back when an AI errors (e.g. out of allowance)", async () => {
  let n = 0;
  const f = async () => (++n === 1 ? new Response("{}", {status: 429}) : new Response(JSON.stringify({choices: [{message: {content: "second"}}]})));
  const r = await ask({OPENAI_API_KEY: "a", DEEPSEEK_API_KEY: "b"}, {model: "openai:x", fallback: ["deepseek:y"], messages: msgs}, f);
  assert.equal(r.body.text, "second"); assert.match(r.body.tried[0].error, /429/);
});

test("respects daily limits", async () => {
  const usage = new Map([["usage:" + new Date().toISOString().slice(0, 10), {openai: {calls: 3, failed: 0, chars: 0}}]]);
  const USAGE = {get: async (k) => usage.get(k) || null, put: async (k, v) => usage.set(k, JSON.parse(v))};
  const r = await ask({OPENAI_API_KEY: "a", USAGE, DAILY_LIMITS: '{"openai":3}'}, {model: "openai:x", messages: msgs}, okOpenAI("no"));
  assert.equal(r.status, 502); assert.equal(r.body.tried[0].error, "daily limit reached");
});

test("counts usage in KV after a reply", async () => {
  const usage = new Map(); const USAGE = {get: async (k) => usage.get(k) || null, put: async (k, v) => usage.set(k, JSON.parse(v))};
  await ask({GEMINI_API_KEY: "k", USAGE}, {model: "gemini:g", messages: msgs}, okOpenAI("hi"));
  const day = [...usage.values()][0]; assert.equal(day.gemini.calls, 1);
});

test("uses Cloudflare's free AI through the AI binding", async () => {
  const AI = {run: async (model, input) => ({response: `ok ${model} ${input.messages.length}`})};
  const r = await ask({AI}, {model: "cloudflare:@cf/meta/llama-3.1-8b-instruct", messages: msgs});
  assert.equal(r.status, 200); assert.match(r.body.text, /^ok @cf\/meta/);
});

test("talks to Claude in Anthropic's format", async () => {
  let sent;
  const f = async (url, init) => { sent = {url, init: JSON.parse(init.body), headers: init.headers}; return new Response(JSON.stringify({content: [{type: "text", text: "claude says hi"}]})); };
  const r = await ask({ANTHROPIC_API_KEY: "k"}, {model: "anthropic:claude-haiku-5-5", messages: [{role: "system", content: "S"}, ...msgs]}, f);
  assert.equal(r.body.text, "claude says hi"); assert.equal(sent.init.system, "S"); assert.equal(sent.headers["x-api-key"], "k");
  assert.match(sent.url, /\/v1\/messages$/);
});

test("rejects oversized requests and empty ones", async () => {
  assert.equal((await ask({}, {model: "openai:x", messages: []})).status, 400);
  assert.equal((await ask({}, {model: "openai:x", messages: [{role: "user", content: "x".repeat(70000)}]})).status, 413);
});

test("the API needs the passcode, and stays shut until one is set", async () => {
  assert.equal((await worker.fetch(req("/api/health"), {})).status, 200);
  assert.equal((await worker.fetch(req("/api/status"), {})).status, 503);
  assert.equal((await worker.fetch(req("/api/status"), {FIREFLY_PASSCODE: "secret"})).status, 401);
  assert.equal((await worker.fetch(req("/api/status", {pass: "wrong!"}), {FIREFLY_PASSCODE: "secret"})).status, 401);
  const ok = await worker.fetch(req("/api/status", {pass: "secret"}), {FIREFLY_PASSCODE: "secret", GEMINI_API_KEY: "k"});
  assert.equal(ok.status, 200); const s = await ok.json();
  assert.equal(s.providers.gemini, true); assert.equal(s.providers.openai, false);
  assert.ok(!JSON.stringify(s).includes("\"k\""), "never returns a key");
});

test("serves the page for everything else", async () => {
  const ASSETS = {fetch: async () => new Response("<html>firefly</html>")};
  const r = await worker.fetch(req("/"), {ASSETS}); assert.equal(await r.text(), "<html>firefly</html>");
});

test("reads every Cloudflare reply shape", async () => {
  const {replyText} = await import("../server/worker.js");
  assert.equal(replyText({response: "a"}), "a");
  assert.equal(replyText({result: {response: "b"}}), "b");
  assert.equal(replyText({choices: [{message: {content: "c"}}]}), "c");
  assert.equal(replyText({output: [{type: "reasoning", content: [{text: "thinking"}]}, {type: "message", content: [{type: "output_text", text: "d"}]}]}), "d");
  assert.equal(replyText({}), "");
});
