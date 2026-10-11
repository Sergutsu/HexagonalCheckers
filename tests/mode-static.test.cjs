const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("the repository ships a single HTML page", () => {
  const pages = fs
    .readdirSync(root)
    .filter((file) => file.endsWith(".html"))
    .sort();
  assert.deepEqual(pages, ["index.html"]);
});

test("the single page loads only local, existing assets", () => {
  const html = read("index.html");
  const urls = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
    .map((m) => m[1])
    .filter((url) => url !== "./" && !/[?#]/.test(url));
  for (const url of urls) {
    assert.equal(/^(https?:)?\/\//.test(url), false, `no CDN: ${url}`);
    assert.ok(fs.existsSync(path.join(root, url)), `missing asset: ${url}`);
  }
  for (const script of [
    "vendor/pixi.min.js",
    "scripts/rules.js",
    "scripts/dominion-rules.js",
    "scripts/app.js",
    "scripts/dominion-app.js",
    "scripts/mode.js",
  ])
    assert.ok(urls.includes(script), `loads ${script}`);
});

test("control IDs are unique and every binding exists in the page", () => {
  const html = read("index.html");
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, "unique IDs");
  for (const file of ["scripts/app.js", "scripts/dominion-app.js"]) {
    const source = read(file);
    for (const [, id] of source.matchAll(/\$\(["']([^"']+)["']\)/g))
      assert.ok(ids.includes(id), `${file} missing control: ${id}`);
  }
});

test("both modes are reachable from the one page", () => {
  const html = read("index.html");
  assert.match(html, /data-mode-link="checkers"/);
  assert.match(html, /data-mode-link="dominion"/);
  assert.match(html, /href="\?game=dominion"/);
});

test("the Pages workflow tests before deploying and stages every shipped asset", () => {
  const workflow = read(".github/workflows/pages.yml");
  assert.match(workflow, /branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /needs: test/);
  assert.match(workflow, /run: npm test/);
  // The automatic GITHUB_TOKEN cannot create a Pages site, so the workflow
  // must not ask configure-pages to enable one.
  assert.doesNotMatch(workflow, /enablement: true/);
  const staged = workflow.match(/cp -R (.+) _site\//)[1].trim().split(/\s+/);
  const html = read("index.html");
  const local = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
    .map((m) => m[1])
    .filter((url) => url !== "./" && !/[?#]/.test(url))
    .map((url) => url.split("/")[0]);
  for (const item of local)
    assert.ok(staged.includes(item), `index.html needs ${item} staged for Pages`);
});
