/**
 * editor macro：錄製（JSONL append-only）、strict/best-effort 重播、compile 成 ops。
 * 格式見 docs/MACRO-RECORD-PLAYBACK.md（pinxing.editor-macro/1）。
 * 注意（decisions D8）：compile 只產出文字檔，不執行上游 macro_runner。
 */

import {
  applyPatch,
  cloneView,
  computeView,
  deepEq,
  type GlyphBase,
  type GlyphView,
  type Patch,
  type PatchOp,
  type PatchTarget,
  type Scope,
} from "./patch";

export type MacroHeader = {
  type: "header";
  format: "pinxing.editor-macro/1";
  id: string;
  created: string;
  stable: { manifest: string; version: string; files: Record<string, string> };
  editor: { version: string };
  glyph: { cp: string; char: string };
  title?: string;
  parent?: string | null;
};

export type MacroAction = {
  type: "action";
  seq: number;
  ts: string;
  op: PatchOp;
  target: PatchTarget;
  scope: Scope;
  before: unknown;
  after: unknown;
  note?: string;
  decision?: "try" | "accept" | "reject";
  status?: "applied" | "undone";
};

export type MacroStatus = { type: "status"; seq: number; status: "applied" | "undone"; ts: string };
export type MacroCheckpoint = { type: "checkpoint"; seq: number; state_sha: string; ts: string };
export type MacroLine = MacroHeader | MacroAction | MacroStatus | MacroCheckpoint;

export function parseMacro(text: string): MacroLine[] {
  const out: MacroLine[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    out.push(JSON.parse(line) as MacroLine);
  }
  return out;
}

export type ReplayResult = {
  view: GlyphView;
  applied: number;
  skipped: { seq: number; reason: string }[];
  drift: boolean;
  stableMismatch: boolean;
};

function actionToPatch(a: MacroAction): Patch {
  return {
    id: `macro-${a.seq}`,
    ts: a.ts,
    seq: a.seq,
    scope: a.scope,
    op: a.op,
    target: a.target,
    before: a.before,
    after: a.after,
    status: "applied",
  };
}

/**
 * 重播。strict：header.stable.version 必須等於目前版本、before 必須等於目前狀態，
 * 任一不符 → drift，不靜默套用（已套的保留並回報）。best-effort：跳過不符項。
 */
export function replay(
  lines: MacroLine[],
  base: GlyphBase,
  opts: { mode: "strict" | "best-effort"; currentStable: string },
): ReplayResult {
  const header = lines.find((l): l is MacroHeader => l.type === "header");
  const stableMismatch = !header || header.stable.version !== opts.currentStable;

  const view = cloneView(base);
  const status = new Map<number, "applied" | "undone">();
  const actions: MacroAction[] = [];
  for (const l of lines) {
    if (l.type === "action") actions.push(l);
    else if (l.type === "status") status.set(l.seq, l.status);
  }

  const skipped: { seq: number; reason: string }[] = [];
  let applied = 0;
  let drift = stableMismatch;

  if (stableMismatch && opts.mode === "strict") {
    return { view, applied: 0, skipped: actions.map((a) => ({ seq: a.seq, reason: "stable drift" })), drift: true, stableMismatch };
  }

  for (const a of actions) {
    const st = status.get(a.seq) ?? "applied";
    if (st !== "applied") continue; // undone 的不套（重播預設只套 applied）
    const patch = actionToPatch(a);
    // before 必須等於目前狀態（deepEq，0.01 容差）
    const probe = cloneView({ ...base, strokes: view.strokes, boxes: view.boxes, leaves: base.leaves });
    void probe;
    const currentBefore = snapshotOf(view, a);
    if (!deepEq(currentBefore, a.before)) {
      drift = true;
      if (opts.mode === "strict") {
        skipped.push({ seq: a.seq, reason: "before mismatch" });
        continue; // strict 不靜默套用；中止後續也視為失敗
      }
      skipped.push({ seq: a.seq, reason: "before mismatch (best-effort skipped)" });
      continue;
    }
    applyPatch(view, patch);
    applied += 1;
  }

  return { view, applied, skipped, drift, stableMismatch };
}

/** 取 action 涉及目標的目前值，用來比 before。 */
function snapshotOf(view: GlyphView, a: MacroAction): unknown {
  if (a.op === "move-box" || a.op === "scale-box") {
    const t = a.target;
    if (t.kind !== "component") return null;
    const key = t.path.join(",");
    const b = view.boxes[key];
    return b ? { ...b } : null;
  }
  const t = a.target;
  if (t.kind !== "stroke") return null;
  const pt = view.strokes[t.stroke]?.points[(a.after as { index: number }).index];
  if (!pt) return null;
  if (a.op === "set-width") return { index: (a.after as { index: number }).index, w: pt.w };
  return { index: (a.after as { index: number }).index, x: pt.x, y: pt.y };
}

/** editor op → macro_runner 命令（decisions D8：只產出，不執行）。 */
export function compileMacro(lines: MacroLine[]): { text: string; unsupported: string[] } {
  const out: string[] = [];
  const unsupported: string[] = [];
  const header = lines.find((l): l is MacroHeader => l.type === "header");
  out.push(`# pinxing.editor-macro compiled${header ? ` from ${header.id}` : ""}`);
  out.push(`# 注意：decisions D8 —— 不執行上游 macro_runner；此檔是機器可重現的證據。`);
  for (const l of lines) {
    if (l.type === "action") {
      if (l.op === "move-box" || l.op === "scale-box") {
        const t = l.target;
        if (t.kind === "component") {
          const b = l.after as { x0: number; y0: number; x1: number; y1: number };
          out.push(
            `place c${t.path.join("_")} ${Math.round(b.x0)} ${Math.round(b.y0)} ${Math.round(b.x1)} ${Math.round(b.y1)}`,
          );
          continue;
        }
      } else if (l.op === "move-point") {
        const t = l.target;
        const a = l.after as { index: number; x: number; y: number };
        const b = l.before as { x: number; y: number };
        if (t.kind === "stroke") {
          out.push(
            `point s${t.stroke} ${a.index} ${Math.round(a.x - b.x)} ${Math.round(a.y - b.y)}`,
          );
          continue;
        }
      } else if (l.op === "set-width") {
        const t = l.target;
        const a = l.after as { index: number; w: number };
        if (t.kind === "stroke") {
          out.push(`setwidth s${t.stroke} ${Math.round(a.w)}`);
          continue;
        }
      }
      unsupported.push(`seq ${l.seq}: op ${l.op}`);
      out.push(`# unsupported: ${l.op} seq=${l.seq}`);
    } else if (l.type === "status") {
      unsupported.push(`status seq=${l.seq}（undo 不進 compiled macro）`);
      out.push(`# status: seq=${l.seq} → ${l.status}`);
    }
  }
  return { text: out.join("\n") + "\n", unsupported };
}

export { computeView };
