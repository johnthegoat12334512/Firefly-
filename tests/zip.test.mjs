import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync, writeFileSync, mkdtempSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";

const mod = {exports: {}};
new Function("module", readFileSync(new URL("../brain.js", import.meta.url), "utf8"))(mod);
const {zip, noteFile} = mod.exports;

test("the vault download is a real zip with every note, accents and all", () => {
  const files = [{name: "Home.md", text: "# Home\n- [[Plan]]"}, {name: "Café plan.md", text: "naïve ✨"}, {name: "Empty.md", text: ""}];
  const dir = mkdtempSync(join(tmpdir(), "ff-")); const path = join(dir, "v.zip");
  writeFileSync(path, zip(files));
  const out = execFileSync("python3", ["-I", "-c", "import sys,zipfile,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))", path]).toString();
  assert.deepEqual(JSON.parse(out), {"Home.md": "# Home\n- [[Plan]]", "Café plan.md": "naïve ✨", "Empty.md": ""});
});

test("note titles become safe file names", () => {
  assert.equal(noteFile("Home"), "Home.md");
  assert.equal(noteFile("a/b: c?"), "a-b- c-.md");
});
