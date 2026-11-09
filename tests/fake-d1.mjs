// A stand-in for Cloudflare D1 built on Node's own SQLite, so the store can be tested locally.
import {DatabaseSync} from "node:sqlite";
export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async run() { const r = db.prepare(sql).run(...args); return {success: true, meta: {changes: Number(r.changes)}}; },
    async all() { return {results: db.prepare(sql).all(...args).map((r) => ({...r}))}; },
    async first() { const r = db.prepare(sql).get(...args); return r ? {...r} : null; },
  });
  return {prepare: (sql) => stmt(sql)};
}
