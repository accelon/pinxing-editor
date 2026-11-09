/**
 * 上游比對（bun scripts/check-upstream.ts）：
 * - 6 檔 stable manifest sha256+bytes 全比對（唯一不變量）。
 * - stable 檔 mtime 與 out/baseline-upstream.txt 基線比對（mtime 不變 = 本專案沒動過上游）。
 * 唯讀；任何 FAIL 即 exit 1。
 */

import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const UP = "D:/2026/pinxing";
const PROJECT = path.resolve(process.cwd());
const BASELINE = path.join(PROJECT, "out/baseline-upstream.txt");

let failed = 0;
const pass = (msg: string) => console.log(`PASS  ${msg}`);
const fail = (msg: string) => {
  failed++;
  console.log(`FAIL  ${msg}`);
};

type Entry = { path: string; bytes: number; sha256: string; role: string };
type Manifest = { format: string; version: string; files: Entry[] };

// 1. sha gate（與 d0-check 同一口徑，雙保險）
const manifest = JSON.parse(readFileSync(path.join(UP, "stable-manifest.json"), "utf8")) as Manifest;
for (const f of manifest.files) {
  const buf = readFileSync(path.join(UP, f.path));
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha === f.sha256 && buf.length === f.bytes) pass(`sha ${f.role}`);
  else fail(`sha ${f.role}（穩定版被改動！）`);
}

// 2. mtime 對基線
const baseline = readFileSync(BASELINE, "utf8");
const mtimeSection = baseline.split("## stable files mtime")[1] ?? "";
const baseLines = mtimeSection
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => /^\d{4}-\d{2}-\d{2} /.test(l));

if (baseLines.length === 0) {
  fail("基線缺少 mtime 段（out/baseline-upstream.txt）");
} else {
  for (const line of baseLines) {
    // "2026-11-08 19:26:15.485707800 +0800 /d/2026/pinxing/stable-manifest.json"
    const m = line.match(/^(\S+ \S+)\s+\S+\s+(\/.+)$/);
    if (!m) continue;
    const baseTime = m[1];
    const unixPath = m[2]; // /d/2026/... (git-bash style)
    const winPath = unixPath.replace(/^\/([a-z])\//, "$1:/").replace(/\//g, "\\");
    try {
      const st = statSync(winPath);
      const iso = st.mtime
        .toISOString()
        .slice(0, 19)
        .replace("T", " ");
      // 基線格式 "2026-11-08 19:26:15"（本地時區 +0800）；stat 用 UTC 比日期+秒有時差，
      // 因此以「日期 + 時分秒本地」重新格式化：
      const local = new Date(st.mtime.getTime());
      const pad = (n: number) => String(n).padStart(2, "0");
      const localStr = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}:${pad(local.getSeconds())}`;
      const baseSec = baseTime.slice(0, 19);
      if (localStr === baseSec) pass(`mtime ${path.basename(winPath)} ${localStr}`);
      else fail(`mtime ${path.basename(winPath)} 基線 ${baseSec} ≠ 現在 ${localStr}`);
      void iso;
    } catch (err) {
      fail(`mtime 讀不到 ${winPath}: ${String(err)}`);
    }
  }
}

console.log(failed === 0 ? "\nCHECK-UPSTREAM PASS（上游未被本專案改動）" : `\nCHECK-UPSTREAM FAIL（${failed}）`);
process.exit(failed === 0 ? 0 : 1);
