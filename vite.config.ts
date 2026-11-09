import { defineConfig, type Plugin } from "vite";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

/**
 * stable bridge — 瀏覽器不能直接讀 D:\2026\pinxing，
 * 由 dev server 代讀，但只准代讀 stable-manifest.json 列出的檔案（role 白名單），
 * 且每次 serve 前比對 sha256；不符就 502「穩定版已變更」。
 * 這是唯讀橋：路徑永遠 resolve 在上游根目錄內，沒有任何寫入。
 *
 * store bridge — /__store/*：本專案可寫區（data/patches、data/macros、data/dev、out/macros）。
 * 資料一律走後端 API（decisions D7：現在是 vite middleware，將來換 Go handler）。
 */

const UPSTREAM = "D:/2026/pinxing";
const MANIFEST_PATH = path.join(UPSTREAM, "stable-manifest.json");
const PROJECT_ROOT = path.resolve(process.cwd());

const STORE_PREFIXES = ["data/patches/", "data/macros/", "data/dev/", "out/macros/"];

type StableEntry = { path: string; bytes: number; sha256: string; role: string };
type Manifest = { format: string; version: string; files: StableEntry[] };

function resolveStorePath(rel: string): string | null {
  const norm = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (norm.includes("..")) return null;
  if (!STORE_PREFIXES.some((pre) => norm.startsWith(pre))) return null;
  const abs = path.resolve(PROJECT_ROOT, norm);
  if (abs !== PROJECT_ROOT && !abs.startsWith(PROJECT_ROOT + path.sep)) return null;
  return abs;
}

async function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function storeBridge(): Plugin {
  return {
    name: "pinxing-store-bridge",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void (async () => {
          const u = new URL(req.url ?? "/", "http://127.0.0.1");
          const url = u.pathname;

          if (url === "/__store/file") {
            const rel = u.searchParams.get("path") ?? "";
            const abs = resolveStorePath(rel);
            if (!abs) {
              res.statusCode = 403;
              res.end(JSON.stringify({ error: `路徑不允許: ${rel}` }));
              return;
            }
            if (req.method === "GET") {
              try {
                const text = await readFile(abs, "utf8");
                res.setHeader("content-type", "text/plain; charset=utf-8");
                res.end(text);
              } catch {
                // 不存在：回 200 + header（避免瀏覽器把 404 記成 console error）
                res.setHeader("content-type", "text/plain; charset=utf-8");
                res.setHeader("x-store-exists", "0");
                res.end("");
              }
              return;
            }
            if (req.method === "PUT") {
              const body = await readBody(req);
              await mkdir(path.dirname(abs), { recursive: true });
              await writeFile(abs, body, "utf8");
              res.statusCode = 204;
              res.end();
              return;
            }
            res.statusCode = 405;
            res.end("method not allowed");
            return;
          }

          if (url === "/__store/append" && req.method === "POST") {
            const body = JSON.parse(await readBody(req)) as { path: string; line: string };
            const abs = resolveStorePath(body.path ?? "");
            if (!abs) {
              res.statusCode = 403;
              res.end(JSON.stringify({ error: `路徑不允許: ${body.path}` }));
              return;
            }
            await mkdir(path.dirname(abs), { recursive: true });
            await appendFile(abs, body.line.replace(/\n+$/, "") + "\n", "utf8");
            res.statusCode = 204;
            res.end();
            return;
          }

          if (url === "/__store/list") {
            const dir = u.searchParams.get("dir") ?? "";
            const abs = resolveStorePath(dir.endsWith("/") ? dir : dir + "/");
            if (!abs) {
              res.statusCode = 403;
              res.end(JSON.stringify({ error: `路徑不允許: ${dir}` }));
              return;
            }
            try {
              const entries = await readdir(abs, { withFileTypes: true });
              res.setHeader("content-type", "application/json; charset=utf-8");
              res.end(
                JSON.stringify(
                  entries
                    .filter((e) => e.isFile())
                    .map((e) => dir.replace(/\/?$/, "/") + e.name)
                    .sort(),
                ),
              );
            } catch {
              res.end("[]");
            }
            return;
          }

          next();
        })().catch((err: unknown) => {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        });
      });
    },
  };
}

function stableBridge(): Plugin {
  const root = path.resolve(UPSTREAM);
  const cache = new Map<string, { sha: string; buf: Buffer }>(); // key = entry.path + sha

  async function readManifest(): Promise<Manifest> {
    const m: Manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"));
    if (m.format !== "pinxing.stable/1") throw new Error(`未知 manifest format: ${m.format}`);
    return m;
  }

  return {
    name: "pinxing-stable-bridge",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void (async () => {
          const url = (req.url ?? "").split("?")[0];
          if (url === "/__stable/manifest") {
            const m = await readManifest();
            res.setHeader("content-type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ format: m.format, version: m.version, files: m.files }));
            return;
          }
          if (url.startsWith("/__stable/file/")) {
            const role = decodeURIComponent(url.slice("/__stable/file/".length));
            const m = await readManifest();
            const entry = m.files.find((f) => f.role === role);
            if (!entry) {
              res.statusCode = 404;
              res.end(JSON.stringify({ error: "role 不在 stable manifest", role }));
              return;
            }
            const abs = path.resolve(root, entry.path);
            if (abs !== root && !abs.startsWith(root + path.sep)) {
              res.statusCode = 403;
              res.end(JSON.stringify({ error: "路徑超出上游根目錄" }));
              return;
            }
            const key = `${entry.path}@${entry.sha256}`;
            let hit = cache.get(key);
            if (!hit) {
              const buf = await readFile(abs);
              const sha = createHash("sha256").update(buf).digest("hex");
              if (sha !== entry.sha256 || buf.length !== entry.bytes) {
                res.statusCode = 502;
                res.end(
                  JSON.stringify({
                    error: "穩定版已變更，請更新 manifest",
                    path: entry.path,
                    expected: entry.sha256,
                    actual: sha,
                  }),
                );
                return;
              }
              hit = { sha, buf };
              cache.set(key, hit);
            }
            res.setHeader(
              "content-type",
              entry.path.endsWith(".json") ? "application/json; charset=utf-8" : "application/octet-stream",
            );
            res.setHeader("content-length", String(hit.buf.length));
            res.end(hit.buf);
            return;
          }
          next();
        })().catch((err: unknown) => {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(err) }));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [stableBridge(), storeBridge()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
