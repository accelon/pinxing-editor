/**
 * components.json 的唯讀適配器。格式見 docs/DATA-CONTRACT.md §3：
 * - glyphs key 是**十進位**碼位字串（實測 `"37007"` = U+908F；doc 舊例寫 hex 是錯的，已更正）。
 * - box 是 0..1、左上原點、y 向下；toBox1024 轉成內部統一的 1024 y-up。
 * - leaf.strokes 不可信（中心點落框法），5 個字之後用 data/dev/DECOMP.json 補。
 */

import { loadStable } from "./stable";

export type Box01 = [number, number, number, number]; // x0, y0(top), x1, y1(bottom)，0..1 y-down
export type Box1024 = { x0: number; y0: number; x1: number; y1: number }; // 1024 y-up，y0 底 / y1 頂

export type Leaf = {
  path: number[];
  char: string;
  box: Box01;
  strokes: number[];
};

export type GlyphComp = {
  tree: unknown;
  leaves: Leaf[];
};

type ComponentsFile = {
  source?: string;
  coord?: string;
  glyphs: Record<string, GlyphComp>;
};

let compsCache: ComponentsFile | null = null;

export async function loadComponents(): Promise<ComponentsFile> {
  if (compsCache) return compsCache;
  const buf = await loadStable("components");
  compsCache = JSON.parse(new TextDecoder().decode(buf)) as ComponentsFile;
  return compsCache;
}

export function getGlyphComp(cp: number): GlyphComp | undefined {
  return compsCache?.glyphs[String(cp)];
}

/** 0..1 y-down → 1024 y-up：x0=b[0]*1024、x1=b[2]*1024、y1=(1-b[1])*1024、y0=(1-b[3])*1024 */
export function toBox1024(b: Box01): Box1024 {
  return {
    x0: b[0] * 1024,
    x1: b[2] * 1024,
    y1: (1 - b[1]) * 1024,
    y0: (1 - b[3]) * 1024,
  };
}
