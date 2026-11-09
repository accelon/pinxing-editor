/**
 * 部件分解載入（D4）：
 * - 5 個已修好的字（5BBC/6174/6C87/857E/8FCD）用 dev fixture：
 *   `data/dev/DECOMP.json`（hex key，筆號真相）＋ `data/dev/boxfit/<hex>.json`（box 1024 y-up）。
 * - 其他字 fallback `components.json`（box 0..1 y-down → toBox1024，strokes 分組可能有誤）。
 * 兩份都是 dev fixture／stable 讀取，全程不寫上游。
 */

import type { Box1024 } from "./components";
import { getGlyphComp, toBox1024 } from "./components";
import { storeGet } from "./store";
import type { Stroke } from "./strokes";

export type OpenLeaf = { path: number[]; char: string; strokes: number[]; box: Box1024 };

type DecompEntry = {
  char: string;
  tree: unknown;
  leaves: { char: string; path: number[]; strokes: number[] }[];
};

type BoxfitLeaf = {
  char: string;
  path: number[];
  strokes: number[];
  box: [number, number, number, number]; // 1024 y-up: x0, y0, x1, y1
};

type BoxfitFile = { cp: string; char: string; leaves: BoxfitLeaf[] };

let decompCache: Record<string, DecompEntry> | null = null;
const boxfitCache = new Map<number, BoxfitFile | null>();

async function loadDecomp(): Promise<Record<string, DecompEntry>> {
  if (decompCache) return decompCache;
  try {
    const text = await storeGet("data/dev/DECOMP.json");
    decompCache = text ? (JSON.parse(text) as Record<string, DecompEntry>) : {};
  } catch {
    decompCache = {};
  }
  return decompCache;
}

async function loadBoxfit(cp: number): Promise<BoxfitFile | null> {
  if (boxfitCache.has(cp)) return boxfitCache.get(cp)!;
  const hex = cp.toString(16).toUpperCase();
  let file: BoxfitFile | null = null;
  try {
    const text = await storeGet(`data/dev/boxfit/${hex}.json`);
    if (text) file = JSON.parse(text) as BoxfitFile;
  } catch {
    file = null;
  }
  boxfitCache.set(cp, file);
  return file;
}

/**
 * 取一個字的 OpenLeaf[]（box 已 1024 y-up）。
 * dev fixture 優先（DECOMP 筆號 + boxfit box）；沒有才 fallback components.json。
 * - DECOMP 有筆號但 boxfit 缺 box：用 `strokes` 算墨跡貼合框（ink bbox），不 fallback 粗槽位框。
 * 回 null = 無任何部件資料。
 */
export async function loadGlyphLeaves(cp: number, strokes?: Stroke[]): Promise<OpenLeaf[] | null> {
  const hex = cp.toString(16).toUpperCase();
  const decomp = await loadDecomp();
  const d = decomp[hex];
  if (d) {
    const bf = await loadBoxfit(cp);
    if (bf) {
      return bf.leaves.map((l) => ({
        path: l.path,
        char: l.char,
        strokes: l.strokes,
        box: { x0: l.box[0], y0: l.box[1], x1: l.box[2], y1: l.box[3] },
      }));
    }
    // DECOMP 有筆號但 boxfit 沒有（如「邏」）：用筆號指派算墨跡貼合框。
    return d.leaves.map((l) => ({
      path: l.path,
      char: l.char,
      strokes: l.strokes,
      box: strokes ? inkBoxOf(strokes, l.strokes) : { x0: 0, y0: 0, x1: 1024, y1: 1024 },
    }));
  }

  const comp = getGlyphComp(cp);
  if (!comp) return null;
  return comp.leaves.map((l) => ({
    path: l.path,
    char: l.char,
    strokes: l.strokes,
    box: toBox1024(l.box),
  }));
}

/**
 * 從一組筆畫的點座標算最小包圍盒（墨跡貼合框），四周加 PAD 邊距。
 * 用於 DECOMP 有筆號、但無 boxfit box 的字（如「邏」），
 * 讓部件框貼合墨跡，縮放時才不會被過大的「版面槽位框」卡住。
 */
export function inkBoxOf(strokes: Stroke[], indices: number[], pad = 24): Box1024 {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const i of indices) {
    const s = strokes[i];
    if (!s) continue;
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX)) return { x0: 0, y0: 0, x1: 1024, y1: 1024 };
  return {
    x0: minX - pad,
    y0: minY - pad,
    x1: maxX + pad,
    y1: maxY + pad,
  };
}
