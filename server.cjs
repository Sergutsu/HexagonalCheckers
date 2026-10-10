/* Optional static server. Nothing to install and nothing to build. */
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = __dirname;
const argument = process.argv.indexOf("--port");
const port = Number(
  argument >= 0 ? process.argv[argument + 1] : process.env.PORT || 3000,
);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Use a valid port, for example: npm start -- --port 3000");
  process.exit(1);
}
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};
const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" });
    res.end("Method not allowed");
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(
      new URL(req.url, "http://static.local").pathname,
    );
  } catch (_) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = path.resolve(root, "." + pathname);
  if (
    !file.startsWith(root + path.sep) ||
    pathname.split("/").some((part) => part.startsWith(".")) ||
    pathname.includes("\0")
  ) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": types[path.extname(file)] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = fs.createReadStream(file);
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  });
});
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, "0.0.0.0", () => {
  console.log(
    `HEX Checkers is ready on port ${port}. No build step. Open http://localhost:${port}`,
  );
});
