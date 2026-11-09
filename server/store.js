/* Firefly's memory on the server: a small document store in Cloudflare D1, shaped like the storage the page
 * already uses inside Claude (collections of documents). Each project has its own set of collections.
 *
 *   GET  /api/projects                     -> {projects:[{id, name, docs, last}]}
 *   GET  /api/db/<project>                 -> {collections:{members:[{id,data}], ...}}
 *   POST /api/db/<project>/<collection>    {op:"add"|"set"|"update"|"delete", id?, data?} -> {id}
 *
 * Tables (created on first use, safe to run again): docs(project, col, id, data, at), usage(day, provider, ...).
 */

export const COLLECTIONS = {members: 100, skills: 100, notes: 500, tasks: 400, usage: 1500, config: 50, chat: 400};
const TRIMMED = new Set(["tasks", "usage", "chat"]);     // oldest dropped past the limit
const MAX_DOC = 60000;                                     // characters per document
const ID = /^[A-Za-z0-9_.:-]{1,80}$/;
export const PROJECT = /^[a-z0-9][a-z0-9-]{0,39}$/;

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS docs (project TEXT NOT NULL, col TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY (project, col, id))",
  "CREATE INDEX IF NOT EXISTS docs_by_time ON docs (project, col, at)",
  "CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, provider TEXT NOT NULL, calls INTEGER NOT NULL DEFAULT 0, failed INTEGER NOT NULL DEFAULT 0, chars INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, provider))",
];
const ready = new WeakSet();
export async function ensureSchema(db) {
  if (ready.has(db)) return;
  for (const sql of SCHEMA) await db.prepare(sql).run();
  ready.add(db);
}

const newId = () => Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

export async function listProjects(db) {
  await ensureSchema(db);
  const {results} = await db.prepare("SELECT project, COUNT(*) AS docs, MAX(at) AS last FROM docs GROUP BY project ORDER BY last DESC").all();
  const names = await db.prepare("SELECT project, data FROM docs WHERE col = 'config' AND id = 'project'").all();
  const name = Object.fromEntries((names.results || []).map((r) => [r.project, parse(r.data)?.name || r.project]));
  return (results || []).map((r) => ({id: r.project, name: name[r.project] || r.project, docs: r.docs, last: r.last}));
}

export async function readProject(db, project) {
  await ensureSchema(db);
  const out = {};
  for (const [col, limit] of Object.entries(COLLECTIONS)) {
    const {results} = await db.prepare("SELECT id, data FROM docs WHERE project = ? AND col = ? ORDER BY at DESC LIMIT ?").bind(project, col, limit).all();
    out[col] = (results || []).map((r) => ({id: r.id, data: parse(r.data) || {}}));
  }
  return out;
}

export async function write(db, project, col, body) {
  if (!PROJECT.test(project || "")) return {status: 400, body: {error: "Bad project name."}};
  if (!COLLECTIONS[col]) return {status: 400, body: {error: "Unknown collection."}};
  const op = body?.op; let id = body?.id;
  if (!["add", "set", "update", "delete"].includes(op)) return {status: 400, body: {error: "Unknown operation."}};
  if (op === "add") id = newId();
  if (!ID.test(id || "")) return {status: 400, body: {error: "Bad document id."}};
  await ensureSchema(db);
  if (op === "delete") {
    await db.prepare("DELETE FROM docs WHERE project = ? AND col = ? AND id = ?").bind(project, col, id).run();
    return {status: 200, body: {id}};
  }
  const data = body?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return {status: 400, body: {error: "Data must be an object."}};
  const text = JSON.stringify(data);
  if (text.length > MAX_DOC) return {status: 413, body: {error: "Document too big."}};
  const at = typeof data.at === "string" && data.at ? data.at : new Date().toISOString();
  if (op === "update") {
    const r = await db.prepare("UPDATE docs SET data = json_patch(data, ?) WHERE project = ? AND col = ? AND id = ?").bind(text, project, col, id).run();
    if (!r?.meta?.changes) return {status: 404, body: {error: "No such document."}};
    return {status: 200, body: {id}};
  }
  await db.prepare("INSERT INTO docs (project, col, id, data, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (project, col, id) DO UPDATE SET data = excluded.data, at = excluded.at")
    .bind(project, col, id, text, at).run();
  if (TRIMMED.has(col)) {
    await db.prepare("DELETE FROM docs WHERE project = ? AND col = ? AND id NOT IN (SELECT id FROM docs WHERE project = ? AND col = ? ORDER BY at DESC LIMIT ?)")
      .bind(project, col, project, col, COLLECTIONS[col]).run();
  }
  return {status: 200, body: {id}};
}

/* AI usage per day, one row per AI provider. Atomic, so parallel calls can't lose a count. */
export async function addUsageRow(db, day, provider, ok, chars) {
  await ensureSchema(db);
  await db.prepare("INSERT INTO usage (day, provider, calls, failed, chars) VALUES (?, ?, ?, ?, ?) ON CONFLICT (day, provider) DO UPDATE SET calls = calls + excluded.calls, failed = failed + excluded.failed, chars = chars + excluded.chars")
    .bind(day, provider, ok ? 1 : 0, ok ? 0 : 1, chars).run();
}
export async function readUsageRows(db, day) {
  await ensureSchema(db);
  const {results} = await db.prepare("SELECT provider, calls, failed, chars FROM usage WHERE day = ?").bind(day).all();
  return Object.fromEntries((results || []).map((r) => [r.provider, {calls: r.calls, failed: r.failed, chars: r.chars}]));
}
