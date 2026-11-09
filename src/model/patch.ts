/**
 * 變形層核心（純函式，無 DOM）：patch 型別、fold、canonical state、sha、impact。
 * 規則：核心 append-only；套用順序 stroke > component > glyph > global 由
 * 「gesture 先切 scope」＋ filter 實現；undo 不刪檔只標 status。
 */

import type { Box1024 } from "../data/components";
import type { Stroke } from "../data/strokes";

export type ScopeKind = "stroke" | "component" | "glyph" | "global";

export type Scope =
  | { kind: "stroke"; cp: number; stroke: number }
  | { kind: "component"; cp: number; path: number[] }
  | { kind: "glyph"; cp: number }
  | { kind: "global" };

export type PatchOp = "move-point" | "set-width" | "move-box" | "scale-box" | "set-style";

export type PatchTarget =
  | { kind: "stroke"; cp: number; stroke: number }
  | { kind: "component"; cp: number; path: number[]; strokeIndices: number[] }
  | { kind: "glyph"; cp: number };

export type Patch = {
  id: string;
  ts: string;
  seq: number;
  scope: Scope;
  op: PatchOp;
  target: PatchTarget;
  before: unknown;
  after: unknown;
  note?: string;
  status: "applied" | "undone";
};

export type LeafMeta = { path: number[]; char: string; strokes: number[] };

export type GlyphBase = {
  cp: number;
  strokes: Stroke[]; // 唯讀基底；fold 時才複製
  boxes: Record<string, Box1024>; // key = path.join(",")
  leaves: LeafMeta[];
};

export type GlyphView = { strokes: Stroke[]; boxes: Record<string, Box1024> };

export function pathKey(path: number[]): string {
  return path.join(",");
}

export function cloneView(base: GlyphBase): GlyphView {
  return {
    strokes: base.strokes.map((s) => ({ points: s.points.map((p) => ({ ...p })) })),
    boxes: Object.fromEntries(Object.entries(base.boxes).map(([k, v]) => [k, { ...v }])),
  };
}

function transformBox(strokes: Stroke[], indices: number[], from: Box1024, to: Box1024): void {
  const fw = from.x1 - from.x0 || 1;
  const fh = from.y1 - from.y0 || 1;
  const sx = (to.x1 - to.x0) / fw;
  const sy = (to.y1 - to.y0) / fh;
  for (const i of indices) {
    const s = strokes[i];
    if (!s) continue;
    for (const p of s.points) {
      p.x = to.x0 + (p.x - from.x0) * sx;
      p.y = to.y0 + (p.y - from.y0) * sy;
    }
  }
}

export function applyPatch(view: GlyphView, p: Patch): void {
  if (p.op === "move-box" || p.op === "scale-box") {
    const t = p.target;
    if (t.kind !== "component") return;
    const before = p.before as Box1024;
    const after = p.after as Box1024;
    transformBox(view.strokes, t.strokeIndices, before, after);
    view.boxes[pathKey(t.path)] = { ...after };
    return;
  }
  if (p.op === "move-point") {
    const t = p.target;
    if (t.kind !== "stroke") return;
    const a = p.after as { index: number; x: number; y: number };
    const pt = view.strokes[t.stroke]?.points[a.index];
    if (!pt) return;
    pt.x = a.x;
    pt.y = a.y;
    return;
  }
  if (p.op === "set-width") {
    const t = p.target;
    if (t.kind !== "stroke") return;
    const a = p.after as { index: number; w: number };
    const pt = view.strokes[t.stroke]?.points[a.index];
    if (!pt) return;
    pt.w = a.w;
    return;
  }
  // set-style：第一版留 schema 不實作
}

/**
 * fold：status=applied 的 patch 依序套用。
 * scopeFilter 非 null 時只套該 scope（+global）——這是「scope 預覽只作用在選定 scope」。
 */
export function computeView(
  base: GlyphBase,
  patches: Patch[],
  scopeFilter: ScopeKind | null,
  draft?: Patch | null,
): GlyphView {
  const view = cloneView(base);
  for (const p of patches) {
    if (p.status !== "applied") continue;
    if (scopeFilter && p.scope.kind !== scopeFilter && p.scope.kind !== "global") continue;
    applyPatch(view, p);
  }
  if (draft) applyPatch(view, draft);
  return view;
}

function n(v: number): number {
  return Math.round(v * 100) / 100;
}

/** 確定性狀態字串（0.01 精度）；跨引擎、跨 reload 可比。 */
export function canonicalState(view: GlyphView): string {
  const boxKeys = Object.keys(view.boxes).sort();
  const boxes = boxKeys.map((k) => {
    const b = view.boxes[k];
    return [k, n(b.x0), n(b.y0), n(b.x1), n(b.y1)];
  });
  const strokes = view.strokes.map((s) => s.points.map((p) => [n(p.x), n(p.y), n(p.w)]));
  return JSON.stringify({ boxes, strokes });
}

export async function stateSha(view: GlyphView): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalState(view));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function numEq(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01;
}

export function deepEq(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return numEq(a, b);
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEq(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
    return ka.every((k) =>
      deepEq((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return a === b;
}

/** 影響面：component → 含該部件的所有字；stroke/glyph → 本字；global → 全庫。 */
export type Impact = { glyphs: number; strokes: number };

export function buildCharIndex(
  glyphs: Record<string, { leaves: { char: string; strokes: number[] }[] }>,
): Map<string, { glyphs: number; strokes: number }> {
  const map = new Map<string, { glyphs: number; strokes: number }>();
  for (const g of Object.values(glyphs)) {
    for (const leaf of g.leaves) {
      const e = map.get(leaf.char) ?? { glyphs: 0, strokes: 0 };
      e.glyphs += 1;
      e.strokes += leaf.strokes.length;
      map.set(leaf.char, e);
    }
  }
  return map;
}

export function impactOf(
  scope: Scope,
  base: GlyphBase,
  charIndex: Map<string, { glyphs: number; strokes: number }>,
  glyphCount: number,
): Impact {
  if (scope.kind === "stroke") return { glyphs: 1, strokes: 1 };
  if (scope.kind === "glyph") return { glyphs: 1, strokes: base.strokes.length };
  if (scope.kind === "global") return { glyphs: glyphCount, strokes: -1 }; // -1 = 全庫（不逐筆算）
  const leaf = base.leaves.find(
    (l) => l.path.length === scope.path.length && l.path.every((v, i) => v === scope.path[i]),
  );
  if (!leaf) return { glyphs: 1, strokes: 1 };
  const hit = charIndex.get(leaf.char);
  return hit ?? { glyphs: 1, strokes: leaf.strokes.length };
}
