import test from "node:test";
import assert from "node:assert/strict";
import {fakeD1} from "./fake-d1.mjs";
import worker from "../server/worker.js";
import {instant, looksSimple, calculate, isHandBack} from "../server/quick-rules.js";
import {isFree} from "../server/quick.js";

const post = (env, path, body) => worker.fetch(new Request("https://f.test" + path, {method: "POST",
  headers: {authorization: "Bearer pw", "content-type": "application/json"}, body: JSON.stringify(body)}), env);

test("no-AI answers: greetings, thanks, help, time, date, maths", () => {
  for (const q of ["hi", "Hey!", "hello team", "good morning"]) assert.ok(instant(q), q);
  for (const q of ["thanks", "Thank you so much!", "ty"]) assert.ok(instant(q), q);
  assert.match(instant("what can you do?", {members: [{name: "Writer"}], lead: "Lead"}), /Firefly.*Writer/);
  assert.match(instant("what time is it", {now: new Date("2026-11-09T14:05:00Z")}), /14:05 UTC/);
  assert.match(instant("what's the date?", {now: new Date("2026-11-09T14:05:00Z")}), /2026-11-09/);
  assert.equal(instant("what is 2+2"), "2+2 = 4");
  assert.equal(instant("15% of 80"), "15% of 80 = 12");
  assert.equal(instant("calculate (3 + 4) * 2^3"), "(3 + 4) * 2^3 = 56");
  assert.equal(instant("what's 12 times 12?"), "12 times 12 = 144");
});

test("no-AI rules stay out of the way of real requests", () => {
  for (const q of ["hi, can you write a launch tweet", "what is gravity", "write a plan", "build me a website", "what is 2 apples"]) assert.equal(instant(q), null, q);
});

test("the calculator is safe", () => {
  assert.equal(calculate("1/0"), null);
  assert.equal(calculate("alert(1)"), null);
  assert.equal(calculate("2+"), null);
  assert.equal(calculate("(1+2"), null);
  assert.equal(calculate("0.1+0.2"), "0.3");
  assert.equal(calculate("-3*-3"), "9");
  assert.equal(calculate("2^10"), "1024");
  assert.equal(calculate("1,000 + 1"), "1001");
});

test("simple questions go to free models; real work, personal and live questions don't", () => {
  for (const q of ["what is the capital of France?", "who wrote Hamlet", "how do magnets work?", "what does HTML stand for?", "is a tomato a fruit?"]) assert.ok(looksSimple(q), q);
  for (const q of ["write a blog post about cats", "what's in my notes?", "what is the price of SOL?", "how do we launch our token?", "what's the latest news", "research three competitors?", "hello", "should I invest in this?"]) assert.ok(!looksSimple(q), q);
});

test("hand-backs are recognised", () => {
  assert.ok(isHandBack("ESCALATE")); assert.ok(isHandBack("**ESCALATE** this needs work")); assert.ok(isHandBack("  "));
  assert.ok(!isHandBack("Paris is the capital of France."));
});

test("only free AIs count as free", () => {
  assert.ok(isFree("cloudflare:@cf/meta/llama-3.3-70b-instruct-fp8-fast"));
  assert.ok(isFree("openrouter:nousresearch/hermes-3-llama-3.1-405b:free"));
  for (const id of ["anthropic:claude-haiku-5-5", "openai:gpt-4o-mini", "gemini:gemini-2.5-flash", "openrouter:paid/model", "deepseek:deepseek-chat"]) assert.ok(!isFree(id), id);
});

function env(reply = "Paris.") {
  let calls = 0;
  const e = {FIREFLY_PASSCODE: "pw", DB: fakeD1(), AI: {run: async () => { calls++; return {response: typeof reply === "function" ? reply() : reply}; }}};
  return {e, calls: () => calls};
}

test("greetings never reach a model", async () => {
  const {e, calls} = env();
  const r = await (await post(e, "/api/quick", {question: "hi"})).json();
  assert.equal(r.answered, true); assert.equal(r.source, "instant"); assert.equal(calls(), 0);
});

test("a simple question is answered free once, then remembered", async () => {
  const {e, calls} = env("Paris is the capital of France.");
  const a = await (await post(e, "/api/quick", {question: "What is the capital of France?"})).json();
  assert.equal(a.source, "free-model"); assert.match(a.model, /^cloudflare:/);
  const b = await (await post(e, "/api/quick", {question: "what is the capital of france"})).json();
  assert.equal(b.source, "remembered"); assert.equal(b.text, "Paris is the capital of France."); assert.equal(calls(), 1);
});

test("a bad answer, once graded, is never served again", async () => {
  const {e, calls} = env("Lyon.");
  await post(e, "/api/quick", {question: "What is the capital of France?"});
  assert.equal((await post(e, "/api/quick/grade", {question: "What is the capital of France?", good: false})).status, 200);
  const again = await (await post(e, "/api/quick", {question: "What is the capital of France?"})).json();
  assert.equal(again.source, "free-model"); assert.equal(calls(), 2);
});

test("real work is passed to the team without spending anything", async () => {
  const {e, calls} = env();
  const r = await (await post(e, "/api/quick", {question: "write a launch plan for our token"})).json();
  assert.equal(r.answered, false); assert.equal(calls(), 0);
});

test("a free model's hand-back goes to the team, and is remembered as too hard", async () => {
  const {e, calls} = env("ESCALATE");
  const a = await (await post(e, "/api/quick", {question: "Why does quantum tunnelling happen?"})).json();
  assert.equal(a.answered, false);
  const b = await (await post(e, "/api/quick", {question: "Why does quantum tunnelling happen?"})).json();
  assert.equal(b.answered, false); assert.equal(calls(), 1, "not asked twice");
});

test("the quick lane never uses a paid AI, even when its key is set and it's asked for", async () => {
  let paid = 0;
  const e = {FIREFLY_PASSCODE: "pw", DB: fakeD1(), ANTHROPIC_API_KEY: "k", OPENAI_API_KEY: "k"};
  const realFetch = globalThis.fetch; globalThis.fetch = async () => { paid++; return new Response("{}", {status: 200}); };
  try {
    const r = await (await post(e, "/api/quick", {question: "Who wrote Hamlet?", freeChain: ["anthropic:claude-opus-5-5", "openai:gpt-4o-mini"]})).json();
    assert.equal(r.answered, false); assert.equal(paid, 0);
  } finally { globalThis.fetch = realFetch; }
});

test("today's quick answers are counted by source", async () => {
  const {e} = env("Paris.");
  await post(e, "/api/quick", {question: "hi"});
  await post(e, "/api/quick", {question: "What is the capital of France?"});
  await post(e, "/api/quick", {question: "What is the capital of France?"});
  const s = await (await worker.fetch(new Request("https://f.test/api/status", {headers: {authorization: "Bearer pw"}}), e)).json();
  assert.deepEqual(s.quick, {"instant": 1, "free-model": 1, "remembered": 1});
});

test("the quick lane needs the passcode", async () => {
  const {e} = env();
  const r = await worker.fetch(new Request("https://f.test/api/quick", {method: "POST", body: "{}"}), e);
  assert.equal(r.status, 401);
});
