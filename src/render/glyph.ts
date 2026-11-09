/**
 * SVG 渲染（D1–D3）：中心線 polyline + 平均半寬，圓頭。
 * 三層高亮：glyph / component / stroke 聯動；部件框有 border hit path（點選/拖移）
 * ＋四角 handle（縮放）；框內部 pointer-events none 讓筆畫可點。
 * 座標：viewBox 0 0 1024 1024；<g transform="translate(0,1024) scale(1,-1)"> y-up 翻正；
 * 標籤與 handle 標記不進翻轉群組，y_svg = 1024 - y_up。
 * A/B：showOriginal=true 時只畫 base 視圖（draft 忽略）。
 */

import type { Stroke } from "../data/strokes";
import type { GlyphView } from "../model/patch";
import type { Selection } from "../model/types";

const NS = "http://www.w3.org/2000/svg";

const COLORS = {
  ink: "#e6e3da",
  inkHighlight: "#7fd0ff", // 選取筆畫
  inkLinked: "#9fb8cc", // 部件/字選取時的連動筆畫
  box: "#5aa9e6",
  boxSelected: "#ffc857",
  label: "#8d8a80",
  labelSelected: "#ffc857",
  handle: "#ffc857",
  abBadge: "#ff7b72",
};

export type RenderArgs = {
  svg: SVGSVGElement;
  view: GlyphView;
  cp: number;
  selection: Selection | null;
  /** 選取所屬部件會連動高亮的筆畫（含 stroke 自身） */
  highlightStrokes: Set<number>;
  /** 選取部件時連動高亮的框 path key */
  highlightBoxKey: string | null;
  /** 筆畫選取時顯示控制點/寬度錨點 */
  showStrokeHandles: boolean;
  /** 部件選取時顯示四角縮放 handle */
  showBoxHandles: boolean;
  /** 部件框 metadata（path → 標籤字） */
  leafMeta: { path: number[]; char: string }[];
  /** A/B：true = 畫原狀（base） */
  showOriginal: boolean;
  onPick: (sel: Selection) => void;
  /** pointerdown 事件由 drag 層接管（部件框/筆畫/控制點） */
  onPointerDown?: (ev: PointerEvent, hit: HitInfo) => void;
};

export type HitInfo =
  | { kind: "glyph" }
  | { kind: "stroke"; index: number }
  | { kind: "component"; path: number[] }
  | { kind: "box-border"; path: number[] }
  | { kind: "box-corner"; path: number[]; corner: "nw" | "ne" | "sw" | "se" }
  | { kind: "point"; stroke: number; index: number }
  | { kind: "width"; stroke: number; index: number };

function el<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/**
 * 把中心線 polyline 依「每點半寬 w」渲染成墨跡（筆壓/寬度剖面）。
 * 做法：逐段畫梯形（兩端各用該端點的半寬 w 沿該段法線展開），
 * 再在每個頂點補一個半徑 = w 的圓（圓頭 join），避免折線處 self-intersect 與錯位。
 * 這樣每點 w 直接反映成該處墨跡粗細：起筆細、收筆頓、撇捺收尖都自然呈現。
 * 這正是 pinxing 的 profile 思路在「每點帶 w」資料模型上的對應實現。
 * 回傳 SVG group 的 d 字串串列（每個子 path 一個 fill）。
 */
function strokeInkPaths(s: Stroke): string[] {
  const pts = s.points;
  if (pts.length === 0) return [];
  if (pts.length === 1) {
    const p = pts[0]!;
    const r = Math.max(0.5, p.w);
    return [`M${p.x - r} ${p.y} A${r} ${r} 0 1 0 ${p.x + r} ${p.y} A${r} ${r} 0 1 0 ${p.x - r} ${p.y} Z`];
  }
  const out: string[] = [];
  // 每段梯形：兩端 (p0,w0)、(p1,w1)，沿該段法線展開
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) continue; // 重疊點跳過
    dx /= len;
    dy /= len;
    const nx = -dy;
    const ny = dx;
    const wa = Math.max(0.5, a.w);
    const wb = Math.max(0.5, b.w);
    const x0 = a.x + nx * wa, y0 = a.y + ny * wa;
    const x1 = b.x + nx * wb, y1 = b.y + ny * wb;
    const x2 = b.x - nx * wb, y2 = b.y - ny * wb;
    const x3 = a.x - nx * wa, y3 = a.y - ny * wa;
    out.push(
      `M${x0.toFixed(2)} ${y0.toFixed(2)} L${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)} L${x3.toFixed(2)} ${y3.toFixed(2)} Z`,
    );
  }
  // 每個頂點補圓（圓頭 join/cap），半徑 = 該點 w；折線轉角處自然圓滑。
  for (const p of pts) {
    const r = Math.max(0.5, p.w);
    out.push(
      `M${p.x - r} ${p.y} A${r} ${r} 0 1 0 ${p.x + r} ${p.y} A${r} ${r} 0 1 0 ${p.x - r} ${p.y} Z`,
    );
  }
  return out;
}

/**
 * 依字形實際 bbox（筆畫點＋部件框）動態設 svg viewBox，讓字形完整居中。
 * 字形資料在 1024 空間常偏下（y-up 底部負值、頂部未到 1024），固定 viewBox 會偏下＋底部被裁。
 * viewBox 保持正方形（取 bbox 長邊），四周留 PAD 邊距；座標仍以 1024 為單位（viewBox 高=寬）。
 */
function fitViewBox(svg: SVGSVGElement, view: GlyphView): void {
  let minX = Infinity;
  let minY = Infinity; // y-up 底部
  let maxX = -Infinity;
  let maxY = -Infinity; // y-up 頂部
  // 只看筆畫（墨跡），不管部件框——部件框常覆蓋 0..1024 全範圍，會讓 fit 失效。
  for (const s of view.strokes) {
    for (const p of s.points) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!isFinite(minX) || maxX - minX < 1) {
    svg.setAttribute("viewBox", "0 0 1024 1024");
    return;
  }
  const PAD = 40;
  // 轉成 y-down（viewBox 用 y-down）：頂部 svgY = 1024 - yUp 頂部，底部 svgY = 1024 - yUp 底部
  const left = minX - PAD;
  const right = maxX + PAD;
  const topDown = 1024 - maxY - PAD; // y-down 頂部（小值）
  const bottomDown = 1024 - minY + PAD; // y-down 底部（大值）
  const w = right - left;
  const h = bottomDown - topDown;
  const side = Math.max(w, h);
  const cx = (left + right) / 2;
  const cy = (topDown + bottomDown) / 2;
  const x = cx - side / 2;
  const y = cy - side / 2;
  svg.setAttribute("viewBox", `${x} ${y} ${side} ${side}`);
}

function pathEquals(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function parseHit(target: Element): HitInfo | null {
  const kind = target.getAttribute("data-kind");
  if (!kind) return null;
  switch (kind) {
    case "glyph":
      return { kind: "glyph" };
    case "stroke":
      return { kind: "stroke", index: Number(target.getAttribute("data-index")) };
    case "component":
      return { kind: "component", path: (target.getAttribute("data-path") ?? "").split(",").map(Number) };
    case "box-border":
      return { kind: "box-border", path: (target.getAttribute("data-path") ?? "").split(",").map(Number) };
    case "box-corner":
      return {
        kind: "box-corner",
        path: (target.getAttribute("data-path") ?? "").split(",").map(Number),
        corner: (target.getAttribute("data-corner") ?? "nw") as "nw" | "ne" | "sw" | "se",
      };
    case "point":
      return {
        kind: "point",
        stroke: Number(target.getAttribute("data-stroke")),
        index: Number(target.getAttribute("data-index")),
      };
    case "width":
      return {
        kind: "width",
        stroke: Number(target.getAttribute("data-stroke")),
        index: Number(target.getAttribute("data-index")),
      };
    default:
      return null;
  }
}

export function renderGlyph(args: RenderArgs): void {
  const {
    svg,
    view,
    cp,
    selection,
    highlightStrokes,
    highlightBoxKey,
    showStrokeHandles,
    showBoxHandles,
    showOriginal,
    onPick,
    onPointerDown,
  } = args;
  svg.replaceChildren();

  // 視口 fit：字形資料在 1024 空間常偏下偏右（y-up 底部可能負值、頂部未到 1024），
  // 固定 viewBox="0 0 1024 1024" 會讓字形偏下、底部被裁。依實際 bbox（筆畫＋部件框）
  // 動態設 viewBox，讓字形完整居中。getScreenCTM 會自動反映 viewBox，拖曳/測試座標不受影響。
  fitViewBox(svg, view);

  const flipped = el("g", { transform: "translate(0,1024) scale(1,-1)" });
  const overlay = el("g", {}); // 不翻轉：標籤、控制點圓點、A/B 徽章

  // 字層背景：點空白 = 選 glyph
  flipped.append(
    el("rect", {
      x: "0",
      y: "0",
      width: "1024",
      height: "1024",
      fill: "transparent",
      "data-kind": "glyph",
    }),
  );

  // 筆畫層
  view.strokes.forEach((s, i) => {
    const selfSel = selection?.kind === "stroke" && selection.index === i;
    const linked = highlightStrokes.has(i);
    const color = selfSel ? COLORS.inkHighlight : linked ? COLORS.inkLinked : COLORS.ink;

    // 墨跡：依每點半寬 w 逐段展開的梯形＋圓頭 join（筆壓剖面）。
    // 每個子 path 獨立 fill；選取時提亮不變形。
    for (const d of strokeInkPaths(s)) {
      flipped.append(
        el("path", {
          d,
          fill: color,
          stroke: "none",
          "pointer-events": "none",
          ...(selfSel ? { "data-sel": "stroke" } : {}),
        }),
      );
    }
    // 透明 hit path：用中心線加寬 stroke（折線處夠粗好點，不依賴多邊形填色）
    const centerD = s.points
      .map((p, idx) => `${idx === 0 ? "M" : "L"}${p.x} ${p.y}`)
      .join(" ");
    flipped.append(
      el("path", {
        d: centerD,
        fill: "none",
        stroke: "transparent",
        "stroke-width": "48",
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "data-kind": "stroke",
        "data-index": String(i),
        style: "cursor:pointer",
      }),
    );

    // 控制點（選取筆畫時）
    if (showStrokeHandles && selfSel) {
      s.points.forEach((p, pi) => {
        // 法線方向（取相鄰點方向）
        const prev = s.points[Math.max(0, pi - 1)];
        const next = s.points[Math.min(s.points.length - 1, pi + 1)];
        let dx = next.x - prev.x;
        let dy = next.y - prev.y;
        const len = Math.hypot(dx, dy) || 1;
        dx /= len;
        dy /= len;
        const nx = -dy;
        const ny = dx;
        // 寬度（壓力）錨點：固定偏移 34px，沿法線伸出，與位置控制點明確分離。
        // 用 overlay 座標（y-down），中心點 svgY = 1024 - p.y。
        const W_OFF = 34;
        const cx = p.x + nx * W_OFF;
        const cy = 1024 - p.y - ny * W_OFF; // 法線在 y-up 是 (nx, ny)；轉 svg y-down 要再取負
        const pcx = Math.max(14, Math.min(1010, p.x));
        const pcy = Math.max(14, Math.min(1010, 1024 - p.y));
        const ax = Math.max(12, Math.min(1012, cx));
        const ay = Math.max(12, Math.min(1012, cy));
        // 連接線（中心 → 壓力錨點），像一根「拉桿」
        overlay.append(
          el("line", {
            x1: String(pcx),
            y1: String(pcy),
            x2: String(ax),
            y2: String(ay),
            stroke: COLORS.handle,
            "stroke-width": "2",
            "stroke-dasharray": "4 4",
            "pointer-events": "none",
          }),
        );
        // 寬度錨點（壓力調整）
        overlay.append(
          el("circle", {
            cx: String(ax),
            cy: String(ay),
            r: "13",
            fill: COLORS.handle,
            stroke: "#14141a",
            "stroke-width": "3",
            "data-kind": "width",
            "data-stroke": String(i),
            "data-index": String(pi),
            style: "cursor:ns-resize",
          }),
        );
        // 壓力值文字（錨點旁）
        const wLabel = el("text", {
          x: String(ax + 14),
          y: String(ay - 10),
          "font-size": "22",
          fill: COLORS.handle,
          "pointer-events": "none",
        });
        wLabel.textContent = String(Math.round(p.w));
        overlay.append(wLabel);
        // 位置控制點（overlay 不翻轉；夾進 viewBox 讓中心可命中）
        overlay.append(
          el("circle", {
            cx: String(pcx),
            cy: String(pcy),
            r: "14",
            fill: "#14141a",
            stroke: COLORS.inkHighlight,
            "stroke-width": "5",
            "data-kind": "point",
            "data-stroke": String(i),
            "data-index": String(pi),
            style: "cursor:move",
          }),
        );
      });
    }
  });

  // 部件框層
  const boxes = Object.entries(view.boxes);
  const leafMeta = args.leafMeta;

  for (const [key, box] of boxes) {
    const path = key.split(",").map(Number);
    const meta = leafMeta.find((l) => pathEquals(l.path, path));
    const char = meta?.char ?? "";
    const selfSel = selection?.kind === "component" && pathEquals(selection.path, path);
    const linked = highlightBoxKey === key;
    // 只有「選中部件」或「選筆畫連動的所屬部件」才畫框；其餘不畫，畫面更乾淨、模式更直觀。
    const drawBox = selfSel || linked;
    const w = box.x1 - box.x0;
    const h = box.y1 - box.y0;

    if (drawBox) {
      // 框內部不攔截（讓筆畫可點）：fill none + pointer-events stroke 的邊框 hit
      flipped.append(
        el("rect", {
          x: String(box.x0),
          y: String(box.y0),
          width: String(w),
          height: String(h),
          fill: "none",
          stroke: selfSel ? COLORS.boxSelected : linked ? COLORS.boxSelected : COLORS.box,
          "stroke-width": selfSel ? "6" : "4",
          "stroke-dasharray": "16 10",
          "pointer-events": "none",
        }),
      );
      // 邊框 hit path：透明加寬描邊，只在邊線上命中（框內筆畫仍可點）
      flipped.append(
        el("rect", {
          x: String(box.x0),
          y: String(box.y0),
          width: String(w),
          height: String(h),
          fill: "none",
          stroke: "transparent",
          "stroke-width": "36",
          "data-kind": "box-border",
          "data-path": key,
          style: "cursor:move",
        }),
      );
    }

    // 四角縮放 handle（overlay 不翻轉）；box 可能超出 0..1024（如 y0<0），
    // handle 中心夾進可視區，且 rect 本身不超出 viewBox（否則中心點 hit 不到）。
    if (showBoxHandles && selfSel) {
      const SIZE = 40;
      const half = SIZE / 2;
      // handle 中心（glyph y-up → svg y）
      const centerCl = (x: number, yUp: number) => ({
        cx: Math.max(half, Math.min(1024 - half, x)),
        cy: Math.max(half, Math.min(1024 - half, 1024 - yUp)),
      });
      const corners: [string, number, number][] = [
        ["nw", box.x0, box.y1],
        ["ne", box.x1, box.y1],
        ["sw", box.x0, box.y0],
        ["se", box.x1, box.y0],
      ];
      for (const [corner, gx, gy] of corners) {
        const { cx, cy } = centerCl(gx, gy);
        overlay.append(
          el("rect", {
            x: String(cx - half),
            y: String(cy - half),
            width: String(SIZE),
            height: String(SIZE),
            fill: COLORS.handle,
            stroke: "#14141a",
            "stroke-width": "4",
            "data-kind": "box-corner",
            "data-path": key,
            "data-corner": corner,
            style: `cursor:${corner === "nw" || corner === "se" ? "nwse" : "nesw"}-resize`,
          }),
        );
      }
    }

    // 標籤（不翻轉）：跟框一致，只在選中／連動時顯示
    if (drawBox) {
      const label = el("text", {
        x: String((box.x0 + box.x1) / 2),
        y: String(1024 - (box.y0 + box.y1) / 2),
        "text-anchor": "middle",
        "dominant-baseline": "central",
        "font-size": "44",
        fill: selfSel || linked ? COLORS.labelSelected : COLORS.label,
        "pointer-events": "none",
      });
      label.textContent = char;
      overlay.append(label);
    }
  }

  // A/B 徽章
  if (showOriginal) {
    const badge = el("text", {
      x: "16",
      y: "36",
      "font-size": "28",
      fill: COLORS.abBadge,
      "font-weight": "bold",
      "pointer-events": "none",
    });
    badge.textContent = "A/B 原狀";
    overlay.append(badge);
  }

  svg.append(flipped, overlay);

  // 點擊分派（click 用於選取；拖曳由 drag 層 pointerdown 處理）
  svg.onclick = (ev: MouseEvent) => {
    const hit = parseHit(ev.target as Element);
    if (!hit) return;
    switch (hit.kind) {
      case "stroke":
        onPick({ kind: "stroke", cp, index: hit.index });
        break;
      case "component":
      case "box-border":
      case "box-corner":
        onPick({ kind: "component", cp, path: hit.path });
        break;
      case "point":
      case "width":
        onPick({ kind: "stroke", cp, index: hit.stroke });
        break;
      case "glyph":
        onPick({ kind: "glyph", cp });
        break;
    }
  };

  if (onPointerDown) {
    svg.onpointerdown = (ev: PointerEvent) => {
      const hit = parseHit(ev.target as Element);
      if (!hit) return;
      onPointerDown(ev, hit);
    };
  }
}
