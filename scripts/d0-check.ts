/**
 * D0 檢查（bun scripts/d0-check.ts，或 bun run d0-check）：
 * 1. 讀母區 stable-manifest.json，逐檔比對 sha256 + bytes（6 檔全綠才算過）。
 * 2. 解 strokes.index.json 與 strokes.bin 的 908F record，印筆數／點數。
 * 3. 讀 components.json 的 908F 部件樹。
 * 全程唯讀上游。
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const UP = "D:/2026/pinxing";
const MANIFEST = path.join(UP, "stable-manifest.json");
const HEX = "908F";
const CP = parseInt(HEX, 16); // 37007

type Entry = { path: string; bytes: number; sha256: string; role: string };
type Manifest = { format: string; version: string; files: Entry[] };

let failed = 0;
const pass = (msg: string) => console.log(`PASS  ${msg}`);
const fail = (msg: string) => {
  failed++;
  console.log(`FAIL  ${msg}`);
};

const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as Manifest;
console.log(`manifest ${manifest.format} version=${manifest.version}`);

// 1. sha gate
for (const f of manifest.files) {
  const buf = readFileSync(path.join(UP, f.path));
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha === f.sha256 && buf.length === f.bytes) {
    pass(`sha ${f.role}  ${f.path}`);
  } else {
    fail(`sha ${f.role}  ${f.path}`);
    console.log(`       expected ${f.sha256.slice(0, 16)}… ${f.bytes} bytes`);
    console.log(`       actual   ${sha.slice(0, 16)}… ${buf.length} bytes`);
  }
}

// 2. index + 908F record
const idx = JSON.parse(readFileSync(path.join(UP, "data/cjk-strokes/strokes.index.json"), "utf8")) as {
  upem: number;
  glyphs: Record<string, [number, number]>;
};
const bin = readFileSync(path.join(UP, "data/cjk-strokes/strokes.bin"));
const rec = idx.glyphs[String(CP)];
if (!rec) {
  fail(`index 沒有 ${HEX}（decimal ${CP}）`);
} else {
  let p = rec[0];
  const strokeCount = bin[p];
  p += 1;
  let points = 0;
  for (let i = 0; i < strokeCount; i++) {
    const m = bin[p];
    p += 1;
    points += m;
    p += m * 5;
  }
  pass(`glyph ${HEX} = ${strokeCount} 筆 / ${points} 點（offset ${rec[0]}, upem ${idx.upem}）`);
  if (strokeCount !== 22) {
    console.log(`WARN  FAST-PROTOTYPE 寫「908F 畫出 22 筆」，實際 ${strokeCount} 筆——以資料為準`);
  }
}

// 3. components 908F
const comps = JSON.parse(readFileSync(path.join(UP, "data/cjk-strokes/components.json"), "utf8")) as {
  glyphs: Record<string, { tree: unknown; leaves: { char: string; path: number[]; box: number[]; strokes: number[] }[] }>;
};
// 實測 key 是十進位（DATA-CONTRACT §3 舊例寫 hex，已更正）
const g = comps.glyphs[String(CP)];
if (!g) {
  fail(`components.json 沒有 ${HEX}（decimal ${CP}）`);
} else {
  pass(`components ${HEX} tree=${JSON.stringify(g.tree)} leaves=${g.leaves.length}`);
  for (const leaf of g.leaves) {
    const b = leaf.box;
    const x0 = b[0] * 1024;
    const x1 = b[2] * 1024;
    const y1 = (1 - b[1]) * 1024;
    const y0 = (1 - b[3]) * 1024;
    console.log(
      `      葉 ${leaf.char} path=[${leaf.path.join(",")}] strokes=[${leaf.strokes.join(",")}] ` +
        `box1024=(${x0.toFixed(0)},${y0.toFixed(0)})–(${x1.toFixed(0)},${y1.toFixed(0)})`,
    );
  }
}

console.log(failed === 0 ? "\nD0-CHECK PASS" : `\nD0-CHECK FAIL（${failed}）`);
process.exit(failed === 0 ? 0 : 1);
