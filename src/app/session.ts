// GlyphSession — 一個字的工作階段：base 資料 + patch 列表 + 選取 + scope + undo/redo。
// 純邏輯與 DOM 解耦，便於 accept 測試。
// 保存格式 = pinxing.editor-macro/1 JSONL：header + actions + checkpoint(state_sha)。

import type { Box1024 } from "../data/components";
import type { Stroke } from "../data/strokes";
import type { Selection } from "../model/types";
import {
  type GlyphBase,
  type GlyphView,
  type Impact,
  type Patch,
  type PatchTarget,
  type Scope,
  type ScopeKind,
  buildCharIndex,
  canonicalState,
  computeView,
  impactOf,
  stateSha,
} from "../model/patch";
import { storeGet, storePut } from "../data/store";

export type CharIndex = ReturnType<typeof buildCharIndex>;

let uid = 0;
function newId(): string {
  uid += 1;
  return `p${Date.now().toString(36)}_${uid}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export class GlyphSession {
  cp = 0;
  char = "";
  base: GlyphBase | null = null;
  patches: Patch[] = [];
  draft: Patch | null = null; // 手勢進行中的未提交 patch（僅 render 用）
  selection: Selection | null = null;
  scope: ScopeKind = "glyph";
  dirty = false;
  stableSha = "";
  editorVersion = "0.1.0";
  charIndex: CharIndex = new Map();
  glyphTotal = 0;
  /** 反向索引：部件字 → 全庫中使用它的字（衍字清單）。 */
  charGlyphs: Map<string, { cp: number; char: string }[]> = new Map();
  /** 手勢期間的全量 canonical 起點（無變化檢測用） */
  private gestureBefore: string | null = null;
  /** 已保存的 canonical，用於判斷 dirty */
  private savedCanonical = "";

  // ---- 開字 -------------------------------------------------------------
  /** 以 leaves 為準建 base（box 已是 1024 y-up）。 */
  open(cp: number, char: string, strokes: Stroke[], leaves: OpenLeaf[]): void {
    const boxes: Record<string, Box1024> = {};
    const meta: LeafMeta[] = [];
    for (const l of leaves) {
      boxes[l.path.join(",")] = { ...l.box };
      meta.push({ path: l.path, char: l.char, strokes: l.strokes });
    }

    this.cp = cp;
    this.char = char;
    this.base = { cp, strokes, boxes, leaves: meta };
    this.patches = [];
    this.draft = null;
    this.selection = { kind: "glyph", cp };
    this.scope = "glyph";
    this.dirty = false;
    this.savedCanonical = "";
    this.gestureBefore = null;
  }

  get hasBase(): boolean {
    return this.base !== null;
  }

  // ---- 視圖 -------------------------------------------------------------
  /** 全量視圖（scope filter 不套 draft 預覽；scope 預覽由 render 層用 computeView 另算）。 */
  view(): GlyphView {
    if (!this.base) throw new Error("尚未開字");
    return computeView(this.base, this.patches, null, this.draft);
  }

  /** scope 預覽視圖：只套選定 scope（+global）的 applied patches。 */
  scopedView(): GlyphView {
    if (!this.base) throw new Error("尚未開字");
    return computeView(this.base, this.patches, this.scope, null);
  }

  canonical(): string {
    return canonicalState(this.view());
  }

  async stateShaStr(): Promise<string> {
    return stateSha(this.view());
  }

  syncDirty(): void {
    this.dirty = this.canonical() !== this.savedCanonical;
  }

  // ---- 手勢（gesture）----------------------------------------------------
  gestureBegin(): void {
    this.gestureBefore = this.base ? canonicalState(computeView(this.base, this.patches, null, null)) : null;
  }

  /** 手勢中：設定 draft patch（尚未進 patches）。 */
  gestureDraft(p: Patch): void {
    this.draft = p;
  }

  /** 手勢結束：draft 進 patches（若狀態有實際變化）。 */
  gestureCommit(): boolean {
    const d = this.draft;
    this.draft = null;
    if (!d || !this.base) return false;
    const now = canonicalState(computeView(this.base, this.patches, null, d));
    if (this.gestureBefore !== null && now === this.gestureBefore) {
      this.gestureBefore = null;
      return false; // 無實際變化
    }
    d.status = "applied";
    d.seq = this.patches.length + 1;
    if (!d.ts) d.ts = nowIso();
    this.patches.push(d);
    this.gestureBefore = null;
    this.syncDirty();
    return true;
  }

  gestureCancel(): void {
    this.draft = null;
    this.gestureBefore = null;
  }

  // ---- 直接提交（不用拖曳的動作，如鍵盤微調）------------------------------
  /** p.before / p.after 必須是目標快照（box / {index,x,y} / {index,w}），供 macro 重播比對。 */
  commit(p: Omit<Patch, "id" | "ts" | "seq" | "status">): boolean {
    if (!this.base) return false;
    const beforeCanonical = canonicalState(computeView(this.base, this.patches, null, null));
    const full: Patch = {
      id: newId(),
      ts: nowIso(),
      seq: this.patches.length + 1,
      status: "applied",
      ...p,
    };
    const afterView = computeView(this.base, [...this.patches, full], null, null);
    if (canonicalState(afterView) === beforeCanonical) return false; // 無實際變化
    this.patches.push(full);
    this.syncDirty();
    return true;
  }

  // ---- undo / redo --------------------------------------------------------
  get canUndo(): boolean {
    return this.patches.some((p) => p.status === "applied");
  }

  get canRedo(): boolean {
    return this.patches.some((p) => p.status === "undone");
  }

  undo(): Patch | null {
    for (let i = this.patches.length - 1; i >= 0; i--) {
      if (this.patches[i].status === "applied") {
        this.patches[i].status = "undone";
        this.syncDirty();
        return this.patches[i];
      }
    }
    return null;
  }

  redo(): Patch | null {
    for (let i = 0; i < this.patches.length; i++) {
      if (this.patches[i].status === "undone") {
        this.patches[i].status = "applied";
        this.syncDirty();
        return this.patches[i];
      }
    }
    return null;
  }

  // ---- scope / impact -----------------------------------------------------
  setScope(s: ScopeKind): void {
    this.scope = s;
  }

  /** 依當前 scope＋選取組成 Scope（scope 預覽與 impact 用）。 */
  currentScope(): Scope {
    switch (this.scope) {
      case "global":
        return { kind: "global" };
      case "glyph":
        return { kind: "glyph", cp: this.cp };
      case "stroke": {
        const idx = this.selection?.kind === "stroke" ? this.selection.index : 0;
        return { kind: "stroke", cp: this.cp, stroke: idx };
      }
      case "component": {
        const path =
          this.selection?.kind === "component"
            ? this.selection.path
            : (this.base?.leaves[0]?.path ?? []);
        return { kind: "component", cp: this.cp, path };
      }
    }
  }

  impact(): Impact {
    if (!this.base) return { glyphs: 0, strokes: -1 };
    return impactOf(this.currentScope(), this.base, this.charIndex, this.glyphTotal);
  }

  // ---- 存 / 讀 ------------------------------------------------------------
  patchPath(): string {
    return `data/patches/${this.cp.toString(16).toUpperCase().padStart(4, "0")}.jsonl`;
  }

  async save(): Promise<void> {
    if (!this.base) throw new Error("尚未開字");
    const header = {
      type: "header",
      format: "pinxing.editor-macro/1",
      id: `${this.cp.toString(16).toUpperCase()}_${Date.now().toString(36)}`,
      created: nowIso(),
      stable: { manifest: "", version: "", files: {} },
      editor: { version: this.editorVersion },
      glyph: { cp: String(this.cp), char: this.char },
    };
    const lines: string[] = [JSON.stringify(header)];
    for (const p of this.patches) {
      lines.push(JSON.stringify({ type: "action", ...p }));
      if (p.status === "undone") {
        lines.push(JSON.stringify({ type: "status", seq: p.seq, status: "undone", ts: nowIso() }));
      }
    }
    const sha = await this.stateShaStr();
    lines.push(JSON.stringify({ type: "checkpoint", seq: this.patches.length, state_sha: sha, ts: nowIso() }));
    await storePut(this.patchPath(), lines.join("\n") + "\n");
    this.savedCanonical = this.canonical();
    this.dirty = false;
  }

  /**
   * 載入既有 patch 檔並重播：
   * - action 依序套用；status 行標記 undone。
   * - 末尾 checkpoint.state_sha 與重播後 state sha 比對 → drift 回報（strict 證據）。
   */
  async loadPatches(): Promise<{ loaded: number; drift: boolean; shaMatch: boolean | null }> {
    if (!this.base) return { loaded: 0, drift: false, shaMatch: null };
    const text = await storeGet(this.patchPath());
    if (text === null) {
      this.patches = [];
      this.savedCanonical = this.canonical();
      this.dirty = false;
      return { loaded: 0, drift: false, shaMatch: null };
    }

    const parsed: Patch[] = [];
    const undoneSeqs = new Set<number>();
    let checkpointSha: string | null = null;
    let badLines = 0;

    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t) continue;
      let obj: Record<string, unknown>;
      try {
        obj = JSON.parse(t) as Record<string, unknown>;
      } catch {
        badLines++;
        continue;
      }
      if (obj.type === "header") continue;
      if (obj.type === "action") {
        parsed.push(obj as unknown as Patch);
      } else if (obj.type === "status") {
        if (obj.status === "undone") undoneSeqs.add(Number(obj.seq));
      } else if (obj.type === "checkpoint") {
        checkpointSha = String(obj.state_sha);
      }
    }

    this.patches = parsed.map((p) => ({
      ...p,
      status: undoneSeqs.has(p.seq) ? "undone" : "applied",
    }));

    const sha = await this.stateShaStr();
    const shaMatch = checkpointSha === null ? null : checkpointSha === sha;
    const drift = badLines > 0 || shaMatch === false;

    this.savedCanonical = this.canonical();
    this.dirty = false;
    return { loaded: this.patches.length, drift, shaMatch };
  }

  // ---- 錨點查詢 -----------------------------------------------------------
  strokeTarget(index: number): PatchTarget {
    return { kind: "stroke", cp: this.cp, stroke: index };
  }

  componentTarget(path: number[]): PatchTarget {
    const leaf = this.base?.leaves.find(
      (l) => l.path.length === path.length && l.path.every((v, i) => v === path[i]),
    );
    return { kind: "component", cp: this.cp, path, strokeIndices: leaf?.strokes ?? [] };
  }

  glyphTarget(): PatchTarget {
    return { kind: "glyph", cp: this.cp };
  }
}

type LeafMeta = { path: number[]; char: string; strokes: number[] };
/** 開字輸入：box 已轉成 1024 y-up（來源可以是 boxfit dev fixture 或 components.json adapter）。 */
export type OpenLeaf = { path: number[]; char: string; strokes: number[]; box: Box1024 };

export type { GlyphView, Impact, Patch, ScopeKind, LeafMeta };
