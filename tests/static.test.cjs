const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

test("all shipped JavaScript parses without a transpiler", () => {
  for (const file of [
    "scripts/app.js",
    "scripts/rules.js",
    "server.cjs",
    "vendor/pixi.min.js",
  ]) {
    assert.doesNotThrow(() =>
      execFileSync(process.execPath, ["--check", path.join(root, file)], {
        stdio: "pipe",
      }),
    );
  }
});

test("every HTML entrypoint asset is local and included in the repository", () => {
  const urls = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
    .map((m) => m[1])
    .filter((url) => url !== "./");
  assert.ok(urls.includes("vendor/pixi.min.js"));
  for (const url of urls) {
    assert.equal(
      /^(https?:)?\/\//.test(url),
      false,
      "the game must not depend on a CDN",
    );
    assert.ok(fs.existsSync(path.join(root, url)), `missing asset: ${url}`);
  }
  for (const font of ["inter.woff2", "space-grotesk.woff2"])
    assert.ok(fs.existsSync(path.join(root, "assets/fonts", font)));
});

test("HTML IDs are unique and every literal game-control binding has an element", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  const app = fs.readFileSync(path.join(root, "scripts/app.js"), "utf8");
  for (const [, id] of app.matchAll(/\$\(['"]([^'"]+)['"]\)/g))
    assert.ok(ids.includes(id), `missing control: ${id}`);
});

test("playing and running rules tests need no installed packages or build script", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  );
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.scripts.build, undefined);
  assert.equal(pkg.scripts.start, "node server.cjs");
  assert.ok(pkg.scripts.test.includes("node --test"));
});
