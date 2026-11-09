/**
 * strokes.bin / strokes.index.json 的唯讀適配器。
 * 格式見 docs/DATA-CONTRACT.md §1–§2：
 *   record = 1B 筆數 { 1B 點數 { int16 x, int16 y, uint8 halfWidth }… }，little-endian。
 * 座標：1024 units、y 向上、基線 y=0。index key 是十進位碼位字串。
 */

import { loadStable } from "./stable";

export type Pt = { x: number; y: number; w: number };
export type Stroke = { points: Pt[] };

type Index = { upem: number; px: number; glyphs: Record<string, [number, number]> };

let indexCache: Index | null = null;
let binCache: ArrayBuffer | null = null;

export async function loadIndex(): Promise<Index> {
  if (indexCache) return indexCache;
  const buf = await loadStable("strokes-index");
  indexCache = JSON.parse(new TextDecoder().decode(buf)) as Index;
  return indexCache;
}

async function loadBin(): Promise<ArrayBuffer> {
  if (binCache) return binCache;
  binCache = await loadStable("strokes");
  return binCache;
}

/** 載入 index 與 bin（平行），供 readGlyph 使用。 */
export async function loadStrokeData(): Promise<Index> {
  const [idx] = await Promise.all([loadIndex(), loadBin()]);
  return idx;
}

export function hasGlyph(cp: number): boolean {
  return !!indexCache?.glyphs[String(cp)];
}

/** 依 offset 解出一個字的筆畫；只 parse 該 record，不解全檔。 */
export function readGlyph(cp: number): Stroke[] {
  if (!indexCache || !binCache) throw new Error("stroke 資料尚未載入");
  const rec = indexCache.glyphs[String(cp)];
  if (!rec) throw new Error(`碼位 ${cp} 不在 strokes.index.json`);
  const view = new DataView(binCache);
  let p = rec[0];
  const strokeCount = view.getUint8(p);
  p += 1;
  const strokes: Stroke[] = [];
  for (let i = 0; i < strokeCount; i++) {
    const pointCount = view.getUint8(p);
    p += 1;
    const points: Pt[] = [];
    for (let j = 0; j < pointCount; j++) {
      const x = view.getInt16(p, true);
      const y = view.getInt16(p + 2, true);
      const w = view.getUint8(p + 4);
      p += 5;
      points.push({ x, y, w });
    }
    strokes.push({ points });
  }
  return strokes;
}
