// Builds the Firefly page.
//   index.html       the single-file page (also what you publish as a Claude artifact)
//   site/index.html  the same page, served by the Cloudflare Worker
//   site/brain-data.json  the team, skills, JEV rules, AI list and notes, read by the page when it runs outside Claude
// Notes come from vault/ (the Obsidian vault: one .md file per note). Everything else comes from data/.
import {readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJsonDir = (dir) => existsSync(join(root, dir)) ? readdirSync(join(root, dir)).filter((f) => f.endsWith(".json")).sort()
  .map((f) => JSON.parse(readFileSync(join(root, dir, f), "utf8"))) : [];

export function readVault(dir = join(root, "vault")) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(".md")).sort().map((f) => ({id: f.slice(0, -3), text: readFileSync(join(dir, f), "utf8")}));
}

export function buildData() {
  const strip = ({at, ...rest}) => rest;
  const cfg = (name, fallback) => existsSync(join(root, "data/config", name)) ? strip(JSON.parse(readFileSync(join(root, "data/config", name), "utf8"))) : fallback;
  return {
    members: readJsonDir("data/members").map(strip),
    skills: readJsonDir("data/skills").map(strip),
    jev: cfg("jev.json", null),
    ai: cfg("ai.json", null),
    notes: readVault(),
  };
}

export function build() {
  const app = readFileSync(join(root, "app.html"), "utf8"), js = readFileSync(join(root, "brain.js"), "utf8");
  if (!app.includes("/*BRAIN_JS*/")) throw new Error("app.html is missing the /*BRAIN_JS*/ marker");
  if (!app.includes("/*AI_JSON*/{models: [], fallback: []}")) throw new Error("app.html is missing the /*AI_JSON*/ marker");
  const data = buildData();
  // The quick-lane rules are shared with the server: inline them as a plain script object.
  const rules = readFileSync(join(root, "server/quick-rules.js"), "utf8").replace(/^export /gm, "");
  const quickJs = `const QuickRules = (() => {\n${rules}\nreturn {normalize, calculate, instant, looksSimple, isHandBack};\n})();`;
  if (!app.includes("/*QUICK_RULES*/")) throw new Error("app.html is missing the /*QUICK_RULES*/ marker");
  const page = app.replace("/*QUICK_RULES*/", () => quickJs).replace("/*BRAIN_JS*/", () => js).replace("/*AI_JSON*/{models: [], fallback: []}", () => JSON.stringify(data.ai || {models: [], fallback: []}).replace(/</g, "\\u003c"));
  writeFileSync(join(root, "index.html"), page);
  mkdirSync(join(root, "site"), {recursive: true});
  // The Claude artifact copy is a fragment (Claude adds the document wrapper); the served copy needs its own.
  const site = `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n` +
    page.replace(/<title>[^<]*<\/title>/, "<title>Firefly</title>").replace(/(<\/style>)/, "$1\n</head><body>") + "\n</body></html>\n";
  writeFileSync(join(root, "site/index.html"), site);
  writeFileSync(join(root, "site/brain-data.json"), JSON.stringify(data, null, 1));
  return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const d = build();
  console.log(`Built: ${d.members.length} members, ${d.skills.length} skills, ${d.notes.length} notes.`);
}
