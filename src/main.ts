/** pinxing-editor — 三級編輯器主程式（D1–D4）。
 * 選取同步、拖曳 patch、undo/redo、scope 預覽、impact、A/B、例子、存/重載重播、匯出、macro。
 */

import "./style.css";
import { loadManifest } from "./data/stable";
import { loadStrokeData, readGlyph, hasGlyph, type Stroke } from "./data/strokes";
import { loadComponents, type Box1024 } from "./data/components";import { loadGlyphLeaves } from "./data/decomp";
import { renderGlyph } from "./render/glyph";
import { selectionId, type Selection } from "./model/types";
import { GlyphSession, type LeafMeta } from "./app/session";
import { bindDrag } from "./ui/drag";
import { computeView, stateSha } from "./model/patch";
import "./tour/shell.css";
import { initTour, startTour, tourState } from "./tour/player";
import { TOUR_INDEX, TOUR_BLOBS } from "./tour-data";

const $ = <T extends Element>(id: string) => document.getElementById(id) as unknown as T;

const cpInput = $<HTMLInputElement>("cp-input");
const cpGo = $<HTMLButtonElement>("cp-go");
const stableVer = $("stable-ver");
const breadcrumbEl = $("breadcrumb");
const leafList = $<HTMLUListElement>("leaf-list");
const derivedTitle = $<HTMLElement>("derived-title");
const derivedList = $<HTMLUListElement>("derived-list");
const strokeUsersTitle = $<HTMLElement>("stroke-users-title");
const strokeUsersList = $<HTMLUListElement>("stroke-users-list");
const exampleList = $<HTMLUListElement>("example-list");
const recentList = $<HTMLUListElement>("recent-list");
const inspector = $("inspector");
const impactEl = $("impact");
const editStateEl = $("edit-state");
const statusEl = $("status");
const canvas = $<SVGSVGElement>("canvas");

const btnUndo = $<HTMLButtonElement>("btn-undo");
const btnRedo = $<HTMLButtonElement>("btn-redo");
const btnSave = $<HTMLButtonElement>("btn-save");
const btnReload = $<HTMLButtonElement>("btn-reload");
const btnAb = $<HTMLButtonElement>("btn-ab");
const btnExportSvg = $<HTMLButtonElement>("btn-export-svg");
const btnExportPng = $<HTMLButtonElement>("btn-export-png");

// ---- 例子（D4）------------------------------------------------------------
// 5 DECOMP + 908F + 日進斗金；缺字在載入時 skip 並回報。
const EXAMPLES: { cp: number; label: string }[] = [
  { cp: 0x5bbc, label: "宼（DECOMP）" },
  { cp: 0x6174, label: "慴（DECOMP）" },
  { cp: 0x6c87, label: "沇（DECOMP）" },
  { cp: 0x857e, label: "蕾（DECOMP）" },
  { cp: 0x8fcd, label: "迍（DECOMP）" },
  { cp: 0x908f, label: "邏（預設）" },
  { cp: 0x65e5, label: "日" },
  { cp: 0x9032, label: "進" },
  { cp: 0x6597, label: "斗" },
  { cp: 0x91d1, label: "金" },
];

const RECENT_KEY = "pinxing.recent";
/** UI 修訂號：改 UI/互動後手動 +1，方便確認瀏覽器載到最新版。 */
const REVISION = "r13";
const session = new GlyphSession();
let abOn = false;
let scopePreview = false;
let ready = false;
let lastStatus = "";

function setStatus(msg: string, isError = false): void {
  lastStatus = msg;
  statusEl.textContent = msg;
  statusEl.setAttribute("title", msg); // 顯示列會省略，完整文字滑過去看
  statusEl.parentElement?.classList.toggle("error", isError);
}

function hexOf(cp: number): string {
  return cp.toString(16).toUpperCase();
}

function charOf(cp: number): string {
  return String.fromCodePoint(cp);
}

function parseHex(raw: string): number | null {
  const s = raw.trim().replace(/^u\+|^0x/i, "");
  if (!/^[0-9a-fA-F]{2,6}$/.test(s)) return null;
  const cp = parseInt(s, 16);
  return cp >= 0 && cp <= 0x10ffff ? cp : null;
}

function findLeaf(sel: Selection): LeafMeta | undefined {
  const leaves = session.base?.leaves;
  if (!leaves) return undefined;
  if (sel.kind === "component") {
    return leaves.find(
      (l) => l.path.length === sel.path.length && l.path.every((v, i) => v === sel.path[i]),
    );
  }
  if (sel.kind === "stroke") {
    // 一筆可能屬於多個嵌套部件（父 + 子）；優先回「最小」＝ path 最深的那個，
    // 例如「園」點裡頭選「袁」而非「囗」。
    let best: LeafMeta | undefined;
    for (const l of leaves) {
      if (!l.strokes.includes(sel.index)) continue;
      if (!best || l.path.length > best.path.length) best = l;
    }
    return best;
  }
  return undefined;
}

// ---- 選取同步（D1）--------------------------------------------------------
/** 高亮集：選筆 → 連動其部件框；選部件 → 連動其筆。 */
function computeHighlight(): { strokes: Set<number>; boxKey: string | null } {
  const strokes = new Set<number>();
  let boxKey: string | null = null;
  const sel = session.selection;
  if (!sel) return { strokes, boxKey };
  if (sel.kind === "stroke") {
    strokes.add(sel.index);
    const leaf = findLeaf(sel);
    if (leaf) boxKey = leaf.path.join(",");
  } else if (sel.kind === "component") {
    boxKey = sel.path.join(",");
    const leaf = findLeaf(sel);
    leaf?.strokes.forEach((i) => strokes.add(i));
  }
  return { strokes, boxKey };
}

function updateBreadcrumb(): void {
  breadcrumbEl.replaceChildren();
  if (!session.hasBase) return;
  const sel = session.selection;
  const parts: { label: string; sel: Selection }[] = [
    { label: session.char, sel: { kind: "glyph", cp: session.cp } },
  ];
  if (sel && sel.kind !== "glyph") {
    const leaf = findLeaf(sel);
    if (leaf) parts.push({ label: leaf.char, sel: { kind: "component", cp: session.cp, path: leaf.path } });
    if (sel.kind === "stroke") parts.push({ label: `第 ${sel.index + 1} 筆`, sel });
  }
  parts.forEach((part, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.textContent = " ＞ ";
      breadcrumbEl.append(sep);
    }
    const span = document.createElement("span");
    span.className = "part";
    span.textContent = part.label;
    if (sel && selectionId(part.sel) === selectionId(sel)) span.classList.add("active");
    span.onclick = () => setSelection(part.sel);
    breadcrumbEl.append(span);
  });
}

function updateLeafList(): void {
  leafList.replaceChildren();
  if (!session.hasBase) return;
  const leaves = session.base!.leaves;
  if (leaves.length === 0) {
    const li = document.createElement("li");
    li.className = "meta";
    li.textContent = "（無部件資料）";
    leafList.append(li);
    return;
  }
  const sel = session.selection;
  for (const leaf of leaves) {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.textContent = leaf.char;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `[${leaf.path.join(",")}] · ${leaf.strokes.length} 筆`;
    li.append(name, meta);
    const active =
      sel?.kind === "component" &&
      sel.path.length === leaf.path.length &&
      sel.path.every((v, i) => v === leaf.path[i]);
    if (active) li.classList.add("active");
    li.onclick = () => setSelection({ kind: "component", cp: session.cp, path: leaf.path });
    leafList.append(li);
  }
}

/** 衍字清單：選中部件時，列出全庫用到它的字（取前 80 個，超出顯示「…等 N 字」）。 */
function updateDerivedList(): void {
  derivedList.replaceChildren();
  const sel = session.selection;
  if (sel?.kind !== "component") {
    derivedTitle.classList.add("hidden");
    return;
  }
  const leaf = findLeaf(sel);
  if (!leaf) {
    derivedTitle.classList.add("hidden");
    return;
  }
  const glyphs = session.charGlyphs.get(leaf.char) ?? [];
  const dedup = new Map<number, string>();
  for (const g of glyphs) dedup.set(g.cp, g.char);
  const items = [...dedup.entries()].sort((a, b) => a[0] - b[0]);
  if (items.length === 0) {
    derivedTitle.classList.add("hidden");
    return;
  }
  derivedTitle.classList.remove("hidden");
  derivedTitle.textContent = `衍字清單（${items.length}）`;
  const SHOW = 80;
  for (const [cp, char] of items.slice(0, SHOW)) {
    const li = document.createElement("li");
    li.className = "derived-item";
    li.textContent = char;
    li.title = `U+${hexOf(cp)}`;
    li.onclick = () => void openGlyph(hexOf(cp));
    derivedList.append(li);
  }
  if (items.length > SHOW) {
    const li = document.createElement("li");
    li.className = "meta";
    li.textContent = `…等共 ${items.length} 字`;
    derivedList.append(li);
  }
}

/** 筆畫的使用部件：選中筆畫時，列出當前字裏哪些部件含這根筆（含筆畫自身），畫面點不到也能從這選。 */
function updateStrokeUsersList(): void {
  strokeUsersList.replaceChildren();
  const sel = session.selection;
  if (sel?.kind !== "stroke" || !session.hasBase) {
    strokeUsersTitle.classList.add("hidden");
    return;
  }
  const idx = sel.index;
  const users = session.base!.leaves.filter((l) => l.strokes.includes(idx));
  if (users.length === 0) {
    strokeUsersTitle.classList.add("hidden");
    return;
  }
  strokeUsersTitle.classList.remove("hidden");
  strokeUsersTitle.textContent = `筆畫 ${idx + 1} 的使用部件`;
  for (const leaf of users) {
    const li = document.createElement("li");
    li.className = "stroke-user-item";
    const name = document.createElement("span");
    name.textContent = leaf.char;
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${leaf.strokes.length} 筆`;
    li.append(name, meta);
    const active =
      sel.kind === "stroke" && users.length === 1; // 唯一部件時預設高亮
    if (active && users.length === 1) li.classList.add("active");
    li.onclick = () => setSelection({ kind: "component", cp: session.cp, path: leaf.path });
    strokeUsersList.append(li);
  }
}

function updateInspector(): void {
  const sel = session.selection;
  if (!session.hasBase || !sel) {
    inspector.textContent = "（未選取）";
    return;
  }
  const lines: string[] = [`id  ${selectionId(sel)}`];
  if (sel.kind === "glyph") {
    lines.push(`char ${session.char}  U+${hexOf(session.cp)}`);
    lines.push(`strokes ${session.base?.strokes.length ?? 0}`);
    lines.push(`components ${session.base?.leaves.length ?? 0}`);
  } else if (sel.kind === "component") {
    const leaf = findLeaf(sel);
    lines.push(`path [${sel.path.join(",")}]`);
    if (leaf) {
      const cur = session.view().boxes[sel.path.join(",")];
      lines.push(`char ${leaf.char}`);
      lines.push(
        `box 1024 y-up  x0=${cur.x0.toFixed(1)} y0=${cur.y0.toFixed(1)} x1=${cur.x1.toFixed(1)} y1=${cur.y1.toFixed(1)}`,
      );
      lines.push(`strokes [${leaf.strokes.join(", ")}]`);
      if (leaf.strokes.length === 0) lines.push("⚠ strokes 為空（不可信欄位）");
    } else {
      lines.push("（找不到對應葉）");
    }
  } else {
    const s = session.view().strokes[sel.index];
    lines.push(`stroke #${sel.index}`);
    if (s && s.points.length > 0) {
      const mean = s.points.reduce((a, p) => a + p.w, 0) / s.points.length;
      lines.push(`points ${s.points.length}  mean halfwidth ${mean.toFixed(1)}`);
      lines.push(`first (${s.points[0].x}, ${s.points[0].y}) w=${s.points[0].w}`);
      const leaf = findLeaf(sel);
      lines.push(`component ${leaf ? leaf.char : "（未分組）"}`);
    }
  }
  inspector.textContent = lines.join("\n");
}

function updateImpact(): void {
  if (!session.hasBase) {
    impactEl.textContent = "—";
    return;
  }
  const im = session.impact();
  const scope = session.currentScope();
  const scopeLabel =
    scope.kind === "component"
      ? `component [${scope.path.join(",")}]`
      : scope.kind === "stroke"
        ? `stroke #${scope.stroke}`
        : scope.kind;
  const strokes = im.strokes < 0 ? "全庫" : String(im.strokes);
  impactEl.textContent = `scope ${scopeLabel}\n→ ${im.glyphs} 字 · ${strokes} 筆`;
}

function updateEditState(): void {
  const applied = session.patches.filter((p) => p.status === "applied").length;
  const undone = session.patches.length - applied;
  editStateEl.textContent = [
    `patches ${session.patches.length}（applied ${applied} · undone ${undone}）`,
    `undo ${session.canUndo ? "可" : "—"} · redo ${session.canRedo ? "可" : "—"}`,
    `dirty ${session.dirty ? "● 未存" : "○ 已同步"}`,
    `scope ${session.scope}${scopePreview ? "（預覽中）" : ""}`,
    abOn ? "A/B 顯示原狀" : "",
  ]
    .filter(Boolean)
    .join("\n");
  btnUndo.disabled = !session.canUndo;
  btnRedo.disabled = !session.canRedo;
}

// ---- 渲染 -----------------------------------------------------------------
function repaint(): void {
  if (!session.hasBase) return;
  const base = session.base!;
  const view = abOn
    ? computeView(base, [], null, null) // A/B：原狀
    : computeView(base, session.patches, scopePreview ? session.scope : null, session.draft);
  const { strokes, boxKey } = computeHighlight();
  const leafMeta = base.leaves.map((l) => ({ path: l.path, char: l.char }));

  renderGlyph({
    svg: canvas,
    view,
    cp: session.cp,
    selection: session.selection,
    highlightStrokes: strokes,
    highlightBoxKey: boxKey,
    showStrokeHandles: !abOn && session.selection?.kind === "stroke",
    showBoxHandles: !abOn && session.selection?.kind === "component",
    showOriginal: abOn,
    leafMeta,
    onPick: cyclePick,
    onPointerDown: undefined, // 由 bindDrag 綁定（見下）
  });

  updateBreadcrumb();
  updateLeafList();
  updateDerivedList();
  updateStrokeUsersList();
  updateInspector();
  updateImpact();
  updateEditState();
  updateScopeLabel();
}

/** 同步頂欄的 scope 狀態指示器（跟 session.scope 一致，非可點選 radio）。 */
function updateScopeLabel(): void {
  const label = document.getElementById("scope-label");
  if (!label) return;
  label.textContent = SCOPE_LABEL[session.scope];
  label.dataset.scope = session.scope;
}

function setSelection(sel: Selection): void {
  session.selection = sel;
  // 選取時自動把 scope 切到對應層（gesture 先切 scope）
  if (sel.kind === "stroke") setScope("stroke", false);
  else if (sel.kind === "component") setScope("component", false);
  else setScope("glyph", false);
  repaint();
}

/** 畫布點選的循環邏輯（更直觀）：
 * 點筆畫 → 先選它所屬部件；再點同一筆 → 選該筆（進筆畫模式）；再點 → 回到部件。
 * 點部件框 → 直接選部件；點字背景 → 選字。清單／breadcrumb 走 setSelection 直接選中，不走循環。 */
function cyclePick(target: Selection): void {
  const cur = session.selection;
  if (target.kind === "stroke") {
    const leaf = findLeaf(target); // 該筆所屬部件
    if (cur?.kind === "stroke" && cur.index === target.index) {
      // 已在筆畫模式，再點同一筆 → 回到所屬部件
      if (leaf) {
        setSelection({ kind: "component", cp: session.cp, path: leaf.path });
        return;
      }
      setSelection({ kind: "glyph", cp: session.cp });
      return;
    }
    if (cur?.kind === "component" && leaf && cur.path.join(",") === leaf.path.join(",")) {
      // 已選中該筆所屬部件，再點筆 → 進筆畫模式
      setSelection(target);
      return;
    }
    // 否則：先選所屬部件
    if (leaf) {
      setSelection({ kind: "component", cp: session.cp, path: leaf.path });
      return;
    }
    setSelection(target);
    return;
  }
  // 部件／字：直接選中（點框即選部件）
  setSelection(target);
}

const SCOPE_LABEL: Record<"stroke" | "component" | "glyph" | "global", string> = {
  stroke: "筆",
  component: "部件",
  glyph: "字",
  global: "全域",
};

function setScope(s: "stroke" | "component" | "glyph" | "global", doRepaint = true): void {
  session.setScope(s);
  if (doRepaint) repaint();
}

// ---- 開字 / 例子 / 最近 ----------------------------------------------------
async function openGlyph(raw: string | number): Promise<boolean> {
  const cp = typeof raw === "number" ? raw : parseHex(raw);
  if (cp === null) {
    setStatus(`「${raw}」不是合法碼位（hex，如 908F）`, true);
    return false;
  }
  if (!hasGlyph(cp)) {
    setStatus(`U+${hexOf(cp)} 不在 strokes.index.json（跳過）`, true);
    return false;
  }
  const t0 = performance.now();
  const strokes: Stroke[] = readGlyph(cp);
  const leaves = await loadGlyphLeaves(cp, strokes);
  if (!leaves) {
    setStatus(`U+${hexOf(cp)} 無部件資料（跳過）`, true);
    return false;
  }
  session.open(cp, charOf(cp), strokes, leaves);
  const { loaded, drift } = await session.loadPatches();
  pushRecent(cp, session.char);
  repaint();
  const ms = (performance.now() - t0).toFixed(1);
  const replayNote = loaded > 0 ? ` · 重播 ${loaded} patches${drift ? " ⚠ drift" : " ✓"}` : "";
  setStatus(
    `${session.char} U+${hexOf(cp)} · ${strokes.length} 筆 · ${leaves.length} 部件 · 出圖 ${ms} ms${replayNote}`,
    drift,
  );
  return true;
}

function pushRecent(cp: number, char: string): void {
  try {
    const arr = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as { cp: number; char: string }[];
    const next = [{ cp, char }, ...arr.filter((r) => r.cp !== cp)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* localStorage 不可用就略過 */
  }
  updateRecentList();
}

function updateRecentList(): void {
  recentList.replaceChildren();
  let arr: { cp: number; char: string }[] = [];
  try {
    arr = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as { cp: number; char: string }[];
  } catch {
    /* noop */
  }
  if (arr.length === 0) {
    const li = document.createElement("li");
    li.className = "meta";
    li.textContent = "（尚無）";
    recentList.append(li);
    return;
  }
  for (const r of arr) {
    const li = document.createElement("li");
    li.textContent = `${r.char} ${hexOf(r.cp)}`;
    li.onclick = () => void openGlyph(hexOf(r.cp));
    recentList.append(li);
  }
}

function updateExampleList(): void {
  exampleList.replaceChildren();
  for (const ex of EXAMPLES) {
    const li = document.createElement("li");
    const exists = hasGlyph(ex.cp);
    li.textContent = `${ex.label} ${hexOf(ex.cp)}`;
    if (!exists) {
      li.classList.add("meta");
      li.title = "缺字，載入時跳過";
    } else {
      li.onclick = () => void openGlyph(hexOf(ex.cp));
    }
    exampleList.append(li);
  }
}

/** 一鍵載入全部例子；缺字 skip 並回報。 */
async function loadAllExamples(): Promise<{ ok: number; skipped: number[] }> {
  let ok = 0;
  const skipped: number[] = [];
  for (const ex of EXAMPLES) {
    const passed = await openGlyph(hexOf(ex.cp));
    if (passed) ok++;
    else skipped.push(ex.cp);
  }
  return { ok, skipped };
}

// ---- undo / redo / save / reload -------------------------------------------
async function doUndo(): Promise<void> {
  const p = session.undo();
  if (p) {
    repaint();
    setStatus(`復原 seq=${p.seq} ${p.op}`);
  }
}

async function doRedo(): Promise<void> {
  const p = session.redo();
  if (p) {
    repaint();
    setStatus(`重做 seq=${p.seq} ${p.op}`);
  }
}

async function doSave(): Promise<void> {
  if (!session.hasBase) return;
  await session.save();
  repaint();
  setStatus(`已存 ${session.patchPath()}（sha checkpoint ✓）`);
}

async function doReload(): Promise<void> {
  if (!session.hasBase) return;
  const ok = await openGlyph(hexOf(session.cp));
  if (ok) setStatus(`重載完成：${lastStatus}`);
}

// ---- A/B -------------------------------------------------------------------
function setAb(on: boolean): void {
  if (abOn === on) return;
  abOn = on;
  btnAb.classList.toggle("active", on);
  repaint();
}

// ---- 匯出 -------------------------------------------------------------------
function download(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function exportSvg(): void {
  const clone = canvas.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("x", "0");
  bg.setAttribute("y", "0");
  bg.setAttribute("width", "1024");
  bg.setAttribute("height", "1024");
  bg.setAttribute("fill", "#17171e");
  clone.insertBefore(bg, clone.firstChild);
  const text = new XMLSerializer().serializeToString(clone);
  download(`${hexOf(session.cp)}.svg`, new Blob([text], { type: "image/svg+xml" }));
  setStatus(`匯出 ${hexOf(session.cp)}.svg`);
}

function exportPng(): void {
  const clone = canvas.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "1024");
  bg.setAttribute("height", "1024");
  bg.setAttribute("fill", "#17171e");
  clone.insertBefore(bg, clone.firstChild);
  const text = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas");
    c.width = 1024;
    c.height = 1024;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0, 1024, 1024);
    c.toBlob((blob) => {
      if (blob) {
        download(`${hexOf(session.cp)}.png`, blob);
        setStatus(`匯出 ${hexOf(session.cp)}.png`);
      }
    }, "image/png");
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(text);
}

// ---- 測試 hook（accept 用）---------------------------------------------------
export type EdSnapshot = {
  ready: boolean;
  cp: number | null;
  selection: string | null;
  scope: string;
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  patchCount: number;
  applied: number;
  impact: { glyphs: number; strokes: number };
  ab: boolean;
  status: string;
};

declare global {
  interface Window {
    __ed: {
      ready: boolean;
      snap(): EdSnapshot;
      stateSha(): Promise<string>;
      open(hex: string): Promise<boolean>;
      pick(sel: Selection): void;
      setScope(s: "stroke" | "component" | "glyph" | "global"): void;
      setScopePreview(on: boolean): void;
      setAb(on: boolean): void;
      undo(): Promise<void>;
      redo(): Promise<void>;
      save(): Promise<void>;
      reload(): Promise<void>;
      loadExamples(): Promise<{ ok: number; skipped: number[] }>;
      patchPath(): string;
      listPatches(): Promise<string[]>;
      clientPoint(gx: number, gy: number): { x: number; y: number };
      box(path: number[]): { x0: number; y0: number; x1: number; y1: number } | undefined;
      baseBox(path: number[]): { x0: number; y0: number; x1: number; y1: number } | undefined;
      changedStrokes(): number[];
      baseSha(): Promise<string>;
      crumb(): string;
      abBadge(): boolean;
      pointClient(stroke: number, index: number): { x: number; y: number } | null;
      borderClient(path: number[]): { x: number; y: number } | null;
      cornerClient(
        path: number[],
        corner: "nw" | "ne" | "sw" | "se",
      ): { x: number; y: number } | null;
    };
    /** 導覽播放器診斷 hook（tour-demo 測試用）。 */
    __tourState(): Record<string, unknown>;
  }
}

window.__ed = {
  get ready() {
    return ready;
  },
  snap(): EdSnapshot {
    return {
      ready,
      cp: session.hasBase ? session.cp : null,
      selection: session.selection ? selectionId(session.selection) : null,
      scope: session.scope,
      canUndo: session.canUndo,
      canRedo: session.canRedo,
      dirty: session.dirty,
      patchCount: session.patches.length,
      applied: session.patches.filter((p) => p.status === "applied").length,
      impact: session.impact(),
      ab: abOn,
      status: lastStatus,
    };
  },
  stateSha: () => session.stateShaStr(),
  open: (hex: string) => openGlyph(hex),
  pick: (sel: Selection) => setSelection(sel),
  setScope: (s) => setScope(s),
  setScopePreview: (on) => {
    scopePreview = on;
    repaint();
  },
  setAb,
  undo: doUndo,
  redo: doRedo,
  save: doSave,
  reload: doReload,
  loadExamples: loadAllExamples,
  patchPath: () => session.patchPath(),
  listPatches: async () => {
    const { storeList } = await import("./data/store");
    return storeList("data/patches/");
  },
  // ---- 測試輔助（accept / 演示用）----
  /** glyph 座標（y-up）→ 螢幕 client 座標（供 playwright 拖曳）。 */
  clientPoint(gx: number, gy: number): { x: number; y: number } {
    const ctm = canvas.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const pt = canvas.createSVGPoint();
    pt.x = gx;
    pt.y = 1024 - gy;
    const loc = pt.matrixTransform(ctm);
    return { x: loc.x, y: loc.y };
  },
  /** 當前 box（view，含 patch）。 */
  box(path: number[]): Box1024 | undefined {
    return session.view().boxes[path.join(",")];
  },
  /** base box（原狀）。 */
  baseBox(path: number[]): Box1024 | undefined {
    if (!session.base) return undefined;
    return session.base.boxes[path.join(",")];
  },
  /** 與 base 相比有變化的筆畫 index。 */
  changedStrokes(): number[] {
    if (!session.base) return [];
    const cur = session.view();
    const out: number[] = [];
    cur.strokes.forEach((s, i) => {
      const b = session.base!.strokes[i];
      if (!b) return;
      const changed =
        s.points.length !== b.points.length ||
        s.points.some(
          (p, j) =>
            Math.abs(p.x - b.points[j].x) > 0.01 ||
            Math.abs(p.y - b.points[j].y) > 0.01 ||
            Math.abs(p.w - b.points[j].w) > 0.01,
        );
      if (changed) out.push(i);
    });
    return out;
  },
  /** 原狀（無 patch）的 state sha，A/B 差異用。 */
  baseSha: async (): Promise<string> => {
    if (!session.base) return "";
    return stateSha(computeView(session.base, [], null, null));
  },
  /** breadcrumb 文字。 */
  crumb(): string {
    return breadcrumbEl.textContent ?? "";
  },
  /** A/B 徽章是否在畫面上。 */
  abBadge(): boolean {
    return !!Array.from(canvas.querySelectorAll("text")).find((t) =>
      (t.textContent ?? "").includes("A/B"),
    );
  },
  /** 筆畫控制點螢幕座標（選取後才存在）。 */
  pointClient(stroke: number, index: number): { x: number; y: number } | null {
    const el = canvas.querySelector(
      `circle[data-kind="point"][data-stroke="${stroke}"][data-index="${index}"]`,
    );
    if (!el) return null;
    const r = (el as SVGCircleElement).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  },
  /** 部件框邊框 hit 的螢幕座標（取上邊中點）。 */
  borderClient(path: number[]): { x: number; y: number } | null {
    const key = path.join(",");
    const b = session.view().boxes[key];
    if (!b) return null;
    return this.clientPoint((b.x0 + b.x1) / 2, b.y1);
  },
  /** 部件框角 handle 螢幕座標（選取後才存在）。 */
  cornerClient(path: number[], corner: "nw" | "ne" | "sw" | "se"): { x: number; y: number } | null {
    const el = canvas.querySelector(
      `rect[data-kind="box-corner"][data-path="${path.join(",")}"][data-corner="${corner}"]`,
    );
    if (!el) return null;
    const r = (el as SVGRectElement).getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  },
};

// ---- 操作導覽（演示播放）----------------------------------------------------
/** 合成 pointer 手勢（導覽「呼叫」用）：走 bindDrag 的真實管線，跟真人拖一樣。
 * pointerdown 打在 handle 上（parseHit 要讀它的 data-*）；move/up 打在 svg 根上——
 * 拖曳第一個 move 會 repaint()（replaceChildren 整批換 DOM），
 * 續發在舊 handle 上的事件冒泡不到 svg，finish 收不到就沒法提交。 */
function synthDrag(target: Element, dx: number, dy: number): void {
  const r = target.getBoundingClientRect();
  const x0 = r.x + r.width / 2;
  const y0 = r.y + r.height / 2;
  const base = {
    bubbles: true,
    cancelable: true,
    pointerId: 7,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
  };
  target.dispatchEvent(new PointerEvent("pointerdown", { ...base, buttons: 1, clientX: x0, clientY: y0 }));
  for (const t of [0.5, 1]) {
    canvas.dispatchEvent(
      new PointerEvent("pointermove", { ...base, buttons: 1, clientX: x0 + dx * t, clientY: y0 + dy * t }),
    );
  }
  canvas.dispatchEvent(
    new PointerEvent("pointerup", { ...base, buttons: 0, clientX: x0 + dx, clientY: y0 + dy }),
  );
}

/**
 * tour `呼叫` allow-list（對齊 tour.config.ts 的 callNames）：
 * dragBox＝拖選中部件框 +12px；dragPoint＝拖選中筆的控制點（arg=點序）+12px；setAb＝切 A/B。
 * 拖曳沒產生 patch 就丟錯，讓導覽停住並記錄失敗（不要默默演過）。
 */
function tourCall(name: string, arg: string): void {
  const before = session.patches.length;
  if (name === "dragBox") {
    const key = session.selection?.kind === "component" ? session.selection.path.join(",") : "";
    const handle = key ? canvas.querySelector(`[data-kind="box-border"][data-path="${key}"]`) : null;
    if (!handle) throw new Error("沒有部件框 handle（先選一個部件）");
    synthDrag(handle, 12, 0);
  } else if (name === "dragPoint") {
    const stroke = session.selection?.kind === "stroke" ? session.selection.index : -1;
    const want = arg.trim();
    const handle =
      (stroke >= 0 && want
        ? canvas.querySelector(`circle[data-kind="point"][data-stroke="${stroke}"][data-index="${want}"]`)
        : null) ??
      (stroke >= 0
        ? Array.from(canvas.querySelectorAll(`circle[data-kind="point"][data-stroke="${stroke}"]`)).pop() ?? null
        : null);
    if (!handle) throw new Error("沒有控制點 handle（先選一條筆）");
    synthDrag(handle, 0, -12);
  } else if (name === "setAb") {
    setAb(arg.trim() === "on");
    return;
  } else {
    throw new Error(`不認得的呼叫「${name}」`);
  }
  if (session.patches.length === before) throw new Error(`${name} 沒有產生 patch（拖曳無變化）`);
}

initTour(
  { call: tourCall, state: () => window.__ed.snap() },
  { index: TOUR_INDEX, blobs: TOUR_BLOBS },
  { appName: "pinxing-editor", storagePrefix: "pinxing.tour" },
);
$<HTMLButtonElement>("tourEntry").addEventListener("click", () => startTour());
window.__tourState = tourState;

// ---- 鍵盤 -------------------------------------------------------------------
document.addEventListener("keydown", (ev) => {
  if (ev.target instanceof HTMLInputElement) return;
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !ev.shiftKey) {
    ev.preventDefault();
    void doUndo();
  } else if (
    (ev.ctrlKey || ev.metaKey) &&
    (ev.key.toLowerCase() === "y" || (ev.key.toLowerCase() === "z" && ev.shiftKey))
  ) {
    ev.preventDefault();
    void doRedo();
  } else if (ev.key === "\\") {
    ev.preventDefault();
    setAb(true);
  }
});

document.addEventListener("keyup", (ev) => {
  if (ev.key === "\\") setAb(false);
});

// ---- 事件綁定 ----------------------------------------------------------------
cpGo.onclick = () => void openGlyph(cpInput.value);
cpInput.onkeydown = (ev) => {
  if (ev.key === "Enter") void openGlyph(cpInput.value);
};

btnUndo.onclick = () => void doUndo();
btnRedo.onclick = () => void doRedo();
btnSave.onclick = () => void doSave();
btnReload.onclick = () => void doReload();
btnAb.onpointerdown = () => setAb(true);
btnAb.onpointerup = () => setAb(false);
btnAb.onpointerleave = () => setAb(false);
btnExportSvg.onclick = () => exportSvg();
btnExportPng.onclick = () => exportPng();

// ---- init ---------------------------------------------------------------------
async function init(): Promise<void> {
  // 載入失敗自動重試一次（dev server 剛起／大檔第一次 fetch 偶爾會失敗）
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const t0 = performance.now();
      const [manifest, , comps] = await Promise.all([loadManifest(), loadStrokeData(), loadComponents()]);
      stableVer.textContent = `stable ${manifest.version} · ${REVISION} · sha gate ✓`;

      // 影響面字索引：全庫 glyph 的 leaf char → 使用次數
      const index = buildIndex(comps.glyphs);
      session.charIndex = index.map;
      session.glyphTotal = index.total;
      session.charGlyphs = index.charGlyphs;

      updateExampleList();
      updateRecentList();

      // 拖曳（D2/D3）
      bindDrag({
        session,
        svg: canvas,
        onFrame: () => repaint(),
        onEnd: (committed) => {
          repaint();
          if (committed) setStatus(`已提交 ${session.patches[session.patches.length - 1]?.op ?? ""} · seq=${session.patches.length}`);
        },
      });

      setStatus(`穩定版載入完成（${(performance.now() - t0).toFixed(0)} ms），自動開 908F`);
      await openGlyph("908F");
      ready = true; // window.__ed.ready 是 getter，會自動回傳此值，無需賦值
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt < 2) {
        setStatus(`載入失敗，1 秒後重試…（${msg}）`, true);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      stableVer.textContent = "stable 載入失敗";
      setStatus(msg, true);
    }
  }
}

function buildIndex(glyphs: Record<string, { leaves: { char: string; strokes: number[] }[] }>): {
  map: Map<string, { glyphs: number; strokes: number }>;
  charGlyphs: Map<string, { cp: number; char: string }[]>;
  total: number;
} {
  const map = new Map<string, { glyphs: number; strokes: number }>();
  const charGlyphs = new Map<string, { cp: number; char: string }[]>();
  let total = 0;
  for (const [cpStr, g] of Object.entries(glyphs)) {
    total++;
    const cp = Number(cpStr);
    const char = String.fromCodePoint(cp);
    for (const leaf of g.leaves) {
      const e = map.get(leaf.char) ?? { glyphs: 0, strokes: 0 };
      e.glyphs += 1;
      e.strokes += leaf.strokes.length;
      map.set(leaf.char, e);
      const list = charGlyphs.get(leaf.char) ?? [];
      list.push({ cp, char });
      charGlyphs.set(leaf.char, list);
    }
  }
  return { map, charGlyphs, total };
}

void init();
