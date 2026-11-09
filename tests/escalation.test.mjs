import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const mod = {exports: {}};
new Function("module", readFileSync(new URL("../brain.js", import.meta.url), "utf8"))(mod);
const {escalation} = mod.exports;

test("spots a hand-up in the usual shapes", () => {
  assert.deepEqual(escalation.parse("ESCALATE: needs real code"), {reason: "needs real code"});
  assert.deepEqual(escalation.parse("  **ESCALATE**: exact numbers"), {reason: "exact numbers"});
  assert.deepEqual(escalation.parse("I can't be sure.\nESCALATE: unsure"), {reason: "unsure"});
  assert.deepEqual(escalation.parse("escalate:"), {reason: "needs a stronger model"});
});

test("a normal answer is not a hand-up", () => {
  assert.equal(escalation.parse("Here is the welcome note."), null);
  assert.equal(escalation.parse("We should not ESCALATE this; it's simple."), null);
  assert.equal(escalation.parse("x".repeat(400) + "\nESCALATE: hmm"), null);
  assert.equal(escalation.parse(""), null);
});

test("the instruction is added to the first user message only, without changing the original", () => {
  const msgs = [{role: "user", content: "You are the Writer."}, {role: "assistant", content: "Understood."}, {role: "user", content: "Write it"}];
  const out = escalation.withInstruction(msgs);
  assert.match(out[0].content, /ESCALATE:/); assert.equal(out[2].content, "Write it");
  assert.equal(msgs[0].content, "You are the Writer.");
});
