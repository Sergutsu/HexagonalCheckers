const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Triad Dominion page loads only local, existing assets", () => {
  const html = read("dominion.html");
  const urls = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map((m) => m[1]);
  for (const url of urls) {
    assert.equal(/^(https?:)?\/\//.test(url), false, `no CDN: ${url}`);
    assert.ok(fs.existsSync(path.join(root, url)), `missing asset: ${url}`);
  }
  for (const script of ["vendor/pixi.min.js", "scripts/rules.js", "scripts/dominion-rules.js", "scripts/dominion-app.js"])
    assert.ok(urls.includes(script), `loads ${script}`);
});

test("Triad Dominion control IDs are unique and every binding exists in the page", () => {
  const html = read("dominion.html");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "unique IDs");
  const app = read("scripts/dominion-app.js");
  for (const [, id] of app.matchAll(/\$\(["']([^"']+)["']\)/g))
    assert.ok(ids.includes(id), `missing control: ${id}`);
});

test("both pages link to each other as game modes", () => {
  assert.match(read("index.html"), /href="dominion\.html"/);
  assert.match(read("dominion.html"), /href="\.\/"/);
});

test("the Pages workflow tests before deploying and stages every shipped asset", () => {
  const workflow = read(".github/workflows/pages.yml");
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /needs: test/);
  assert.match(workflow, /run: npm test/);
  const staged = workflow.match(/cp -R (.+) _site\//)[1].trim().split(/\s+/);
  const pages = ["index.html", "dominion.html"];
  for (const page of pages) {
    const html = read(page);
    const local = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
      .map((m) => m[1])
      .filter((url) => url !== "./" && !/^(https?:)?\/\//.test(url))
      .map((url) => url.split("/")[0]);
    for (const item of local)
      assert.ok(staged.includes(item), `${page} needs ${item} staged for Pages`);
  }
  for (const script of fs.readdirSync(path.join(root, "scripts")))
    assert.ok(staged.includes("scripts"), `scripts/${script} is staged`);
});

test("all new JavaScript parses without a transpiler", () => {
  const { execFileSync } = require("node:child_process");
  for (const file of ["scripts/dominion-rules.js", "scripts/dominion-app.js"])
    execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
});
