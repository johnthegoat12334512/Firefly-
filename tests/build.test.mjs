import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {build} from "../scripts/build.mjs";

test("build makes the page and the data file", () => {
  const d = build();
  const page = readFileSync(new URL("../site/index.html", import.meta.url), "utf8");
  assert.ok(!page.includes("/*BRAIN_JS*/") && !page.includes("/*AI_JSON*/"), "markers replaced");
  assert.ok(page.includes("gateway(cfg)"), "engine inlined");
  assert.ok(d.notes.some((n) => n.id === "Home"), "vault notes included");
  assert.ok(d.members.some((m) => m.hub), "has a Lead");
  assert.ok(Array.isArray(d.ai.tiers.easy) && d.ai.tiers.easy.length, "easy tier listed");
});

test("every tier and member model points at a listed AI", () => {
  const d = build(); const ids = new Set(d.ai.models.map((m) => m.id));
  for (const [t, chain] of Object.entries(d.ai.tiers)) for (const id of chain) assert.ok(ids.has(id), `${t}: ${id} not in models`);
  for (const id of d.ai.fallback) assert.ok(ids.has(id), `fallback ${id}`);
  for (const m of d.members) assert.ok(/^tier:/.test(m.model) ? d.ai.tiers[m.model.slice(5)] : true, `${m.id} uses unknown ${m.model}`);
});

test("no secrets in the built files", () => {
  build();
  for (const f of ["../site/index.html", "../site/brain-data.json"]) {
    const s = readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(!/sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|sk-ant-/.test(s), f + " looks like it has a key");
  }
});
