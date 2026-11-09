/**
 * 拖曳手勢層（D2/D3）：
 * - 座標轉換：svg.getScreenCTM() 逆矩陣 → viewBox 座標；再 y-up 翻轉 glyphY = 1024 - svgY。
 * - drag threshold 3px：沒超過就只算點擊（選取由 click 處理）。
 * - 手勢類型：box-move（拖框）、box-resize（四角）、point（控制點）、width（法線投影改 w）。
 * - 拖曳中用 session.gestureDraft 產生 draft patch，結束 gestureCommit。
 */

import type { Box1024 } from "../data/components";
import type { GlyphSession } from "../app/session";
import type { Patch, PatchOp, Scope } from "../model/patch";
import { parseHit, type HitInfo } from "../render/glyph";

const THRESHOLD = 3; // px

export type DragDeps = {
  session: GlyphSession;
  svg: SVGSVGElement;
  /** 手勢中每幀重繪 */
  onFrame: () => void;
  /** 手勢結束（成功或取消） */
  onEnd: (committed: boolean) => void;
};

type DragState = {
  hit: HitInfo;
  startX: number; // 螢幕 px
  startY: number;
  startGlyph: { x: number; y: number }; // y-up
  active: boolean;
  startBox: Box1024 | null;
  startPts: { x: number; y: number; w: number }[] | null;
  strokeIndex: number;
  pointIndex: number;
};

let drag: DragState | null = null;

/** 屏幕座標 → glyph 座標（y-up, 0..1024）。 */
export function screenToGlyph(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const loc = pt.matrixTransform(ctm.inverse());
  return { x: loc.x, y: 1024 - loc.y };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function newDraftId(): string {
  return `d${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function scopeFor(session: GlyphSession, hit: HitInfo): Scope {
  if (hit.kind === "stroke" || hit.kind === "point" || hit.kind === "width") {
    const idx = hit.kind === "stroke" ? hit.index : hit.stroke;
    return { kind: "stroke", cp: session.cp, stroke: idx };
  }
  if (hit.kind === "component" || hit.kind === "box-border" || hit.kind === "box-corner") {
    return { kind: "component", cp: session.cp, path: hit.path };
  }
  return { kind: "glyph", cp: session.cp };
}

export function bindDrag(deps: DragDeps): () => void {
  const { session, svg, onFrame, onEnd } = deps;

  const onDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    const hit = parseHit(ev.target as Element);
    if (!hit) return;
    const g = screenToGlyph(svg, ev.clientX, ev.clientY);
    const startBox =
      hit.kind === "box-border" || hit.kind === "box-corner"
        ? { ...(session.view().boxes[hit.path.join(",")] as Box1024) }
        : null;
    const strokeIndex =
      hit.kind === "stroke" ? hit.index : hit.kind === "point" || hit.kind === "width" ? hit.stroke : -1;
    const startPts =
      strokeIndex >= 0
        ? (session.view().strokes[strokeIndex]?.points.map((p) => ({ ...p })) ?? null)
        : null;

    drag = {
      hit,
      startX: ev.clientX,
      startY: ev.clientY,
      startGlyph: g,
      active: false,
      startBox,
      startPts,
      strokeIndex,
      pointIndex: hit.kind === "point" || hit.kind === "width" ? hit.index : -1,
    };
    // 不 setPointerCapture：它會讓 pointerup 的 target 變成 svg，與 pointerdown 的 target
    // （筆畫 hit path）不一致，瀏覽器因此不合成 click，導致「點筆畫選取」失效。
    // 改用 document 級 move/up 監聽兜住拖曳（滑鼠移出 svg 也能繼續拖）。
    session.gestureBegin();
  };

  const onMove = (ev: PointerEvent) => {
    if (!drag) return;
    const dxScreen = ev.clientX - drag.startX;
    const dyScreen = ev.clientY - drag.startY;
    if (!drag.active) {
      if (Math.hypot(dxScreen, dyScreen) < THRESHOLD) return;
      drag.active = true;
    }
    const g = screenToGlyph(svg, ev.clientX, ev.clientY);
    const hit = drag.hit;

    if ((hit.kind === "box-border" || hit.kind === "box-corner") && drag.startBox) {
      const b0 = drag.startBox;
      let after: Box1024;
      let op: PatchOp = "move-box";
      if (hit.kind === "box-border") {
        const dx = g.x - drag.startGlyph.x;
        const dy = g.y - drag.startGlyph.y;
        after = { x0: b0.x0 + dx, y0: b0.y0 + dy, x1: b0.x1 + dx, y1: b0.y1 + dy };
      } else {
        op = "scale-box";
        // delta-based：handle 可能被夾進可視區（box 超出 0..1024），
        // 用「相對手勢起點的位移」改邊，避免絕對座標把邊吸到滑鼠位置。
        const minSize = 40;
        const dx = g.x - drag.startGlyph.x;
        const dy = g.y - drag.startGlyph.y;
        let x0 = b0.x0;
        let y0 = b0.y0;
        let x1 = b0.x1;
        let y1 = b0.y1;
        if (hit.corner.includes("w")) x0 = Math.min(b0.x0 + dx, x1 - minSize);
        if (hit.corner.includes("e")) x1 = Math.max(b0.x1 + dx, x0 + minSize);
        if (hit.corner.includes("s")) y0 = Math.min(b0.y0 + dy, y1 - minSize);
        if (hit.corner.includes("n")) y1 = Math.max(b0.y1 + dy, y0 + minSize);
        after = { x0, y0, x1, y1 };
      }
      const leaf = session.base?.leaves.find(
        (l) => l.path.length === hit.path.length && l.path.every((v, i) => v === hit.path[i]),
      );
      const draft: Patch = {
        id: newDraftId(),
        ts: new Date().toISOString(),
        seq: 0,
        scope: scopeFor(session, hit),
        op,
        target: { kind: "component", cp: session.cp, path: hit.path, strokeIndices: leaf?.strokes ?? [] },
        before: b0,
        after,
        status: "applied",
      };
      session.gestureDraft(draft);
      onFrame();
      return;
    }

    if ((hit.kind === "point" || hit.kind === "width") && drag.startPts) {
      const pts = drag.startPts;
      const pi = drag.pointIndex;
      const p0 = pts[pi];
      if (!p0) return;
      let after: { index: number; x: number; y: number } | { index: number; w: number };
      let op: PatchOp;
      if (hit.kind === "point") {
        op = "move-point";
        after = {
          index: pi,
          x: clamp(p0.x + (g.x - drag.startGlyph.x), 0, 1024),
          y: clamp(p0.y + (g.y - drag.startGlyph.y), 0, 1024),
        };
      } else {
        op = "set-width";
        // 法線投影：拖曳位移在法線方向的分量改 w
        const ptsArr = session.view().strokes[drag.strokeIndex]?.points ?? [];
        const prev = ptsArr[Math.max(0, pi - 1)] ?? p0;
        const next = ptsArr[Math.min(ptsArr.length - 1, pi + 1)] ?? p0;
        let dx = next.x - prev.x;
        let dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        const nx = -dy;
        const ny = dx;
        const moveDx = g.x - drag.startGlyph.x;
        const moveDy = g.y - drag.startGlyph.y;
        const proj = moveDx * nx + moveDy * ny;
        // 寬度錨點固定偏移 34px（render/glyph.ts），拖曳位移的法線分量即 w 變化（1:1）
        after = { index: pi, w: clamp(p0.w + proj, 1, 200) };
      }
      const draft: Patch = {
        id: newDraftId(),
        ts: new Date().toISOString(),
        seq: 0,
        scope: scopeFor(session, hit),
        op,
        target: { kind: "stroke", cp: session.cp, stroke: drag.strokeIndex },
        before: p0,
        after,
        status: "applied",
      };
      session.gestureDraft(draft);
      onFrame();
      return;
    }
    // stroke 本體拖曳（整個筆畫平移）：第一版不做，選取即可
  };

  const finish = async (_ev: PointerEvent) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.active) {
      // 純點擊（沒超過拖曳門檻）：不 gestureCommit、不 onEnd（避免 repaint 重建 DOM），
      // 讓瀏覽器正常合成 click，由 render 層的 click 選取處理。
      session.gestureCancel();
      return;
    }
    const committed = await session.gestureCommit();
    onEnd(committed);
  };

  const onUp = (ev: PointerEvent) => void finish(ev);
  const onCancel = (_ev: PointerEvent) => {
    if (!drag) return;
    drag = null;
    session.gestureCancel();
    onEnd(false);
  };

  svg.addEventListener("pointerdown", onDown as EventListener);
  // move/up/cancel 綁在 document：拖曳中滑鼠移出 svg 也能繼續，且不依賴 pointer capture。
  document.addEventListener("pointermove", onMove as EventListener);
  document.addEventListener("pointerup", onUp as EventListener);
  document.addEventListener("pointercancel", onCancel as EventListener);

  return () => {
    svg.removeEventListener("pointerdown", onDown as EventListener);
    document.removeEventListener("pointermove", onMove as EventListener);
    document.removeEventListener("pointerup", onUp as EventListener);
    document.removeEventListener("pointercancel", onCancel as EventListener);
  };
}
