# FAST-PROTOTYPE — 三級編輯器（筆畫／部件／字）

> 給 `pinxing-editor` 的實作 agent。上游 `D:\2026\pinxing` **唯讀**；所有產物寫這個 repo。
> 目標不是完整產品，是 **5 個工作天內可以打開、選取、拖動、存檔、重播** 的原型。

## 0. 一句話

**一個字、三層同步：字（glyph）→ 部件（component）→ 筆畫（stroke）；拖動只產生 delta，不寫核心資料。**

## 1. 關鍵詞（先掃一遍）

`三級編輯器`、`筆畫／部件／字`、`作用域（scope）`、`delta／override／patch`、
`核心層／變形層／promote`、`natural box`、`slot`、`部件比例`、`構形序`、`合文`、
`部件實例 vs standalone`、`strokes.bin`、`components.json`、`DECOMP.json`、
`proportions.jsonl`、`base.json`、`canvas／place／extend`、`macro_runner`、
`pinxing.ts`、`centerline`、`half-width`、`1024 units / y-up`、`breadcrumb`、
`hit-test`、`undo/redo`、`A/B compare`、`impact count`。

完整術語見 [`KEYWORDS.md`](KEYWORDS.md)。

## 2. 邊界（硬規則）

1. **不寫 `D:\2026\pinxing`**：不改 `.bin`、不改 `components.json`、不跑會寫 `state.json`／`receipt.json` 的 macro。
2. **不引入 GPL 的 `kage-engine`**；pinxing 是 Apache-2.0。要抄它的純函式， copy 到本 repo 並註明來源。
3. **核心 append-only**：所有編輯只存在 `data/patches/*.json`（變形層）；不把調校結果寫回 `strokes.bin`。
4. **id 不用陣列索引**：用 `glyph:<cp>`、`component:<cp>:<path>`、`stroke:<cp>:<index>`。
5. 先量再改：每個互動都要有可重跑的 acceptance script。

## 3. 資料（穩定 vs 開發）

**穩定版**只從 `D:\2026\pinxing\stable-manifest.json` 取（啟動比對 sha）；**開發版**（`out/`）不要直接讀，必要時複製到 `pinxing-editor/data/dev/` 並標 `dev fixture`。

| 用途 | 路徑 | 層 | 重點 |
| --- | --- | --- | --- |
| 筆畫 | `data/cjk-strokes/strokes.bin` | 穩定 | 1B 筆數／1B 點數／每點 `<hhB>(x,y,半寬)`；1024 單位、y 向上、基線 0 |
| 索引 | `data/cjk-strokes/strokes.index.json` | 穩定 | `glyphs["<十進位 cp>"] = [offset, count]` |
| 部件樹 | `data/cjk-strokes/components.json` | 穩定 | `tree`／`leaves[{path,char,box,strokes}]`；**box 是 0..1、左上原點、y 向下**；`strokes` 不可信 |
| 筆數 | `data/cjk-strokes/build-report.json` | 穩定 | 每字 `strokes`／`components` |
| 渲染器 | `src/pinxing.ts` | 穩定 | KAGE→SVG；純函式 `glyphPolygons()`／`buildOutline()` 可參考 |
| 修正分解 | `out/boxfit/DECOMP.json` | **開發** | 5 個已修好的字（沇／迍／蕾／慴／宼）；要用的話複製到 `data/dev/` |
| 已調比例 | `out/boxfit/proportions.jsonl` | **開發** | 一行一字；`best_iou`／`candidate`；同上 |
| 部件框（單字） | `out/boxfit/<cp>.json` | **開發** | `box`、`box_kind`、`overlap`、`best_iou`；同上 |
| 母字／合文 | `out/compose/work/base.json`、`ops-*.macro` | **開發** | `base.json` 是 `{chars:{<hex>:{char,strokes}}}`；要用的話複製到 `data/dev/` |

格式細節見 [`DATA-CONTRACT.md`](DATA-CONTRACT.md)；穩定版規則見 [`STABLE-INPUTS.md`](STABLE-INPUTS.md)。

## 4. MVP 範圍

**要做：**

- 載入單字（`strokes.bin`）與部件樹（`components.json`；5 個字用 `data/dev/DECOMP.json`，dev fixture）。
- 三層同時可見：字墨跡、部件框、筆畫中心線／控制點／半寬。
- 點選任一層 → 另兩層高亮；breadcrumb（`邏 ＞ 罒 ＞ 第 3 筆`）。
- 拖部件框（位置／縮放）；拖筆畫控制點、寬度錨點；即時預覽。
- scope：`stroke / component / glyph`；顯示 impact count（影響幾個字／幾筆）。
- undo/redo（≥20 步）、A/B 對照、存 patch JSON、重載重播。
- 10 個例子一鍵載入（先做 5 個 boxfit 字＋M9 的 `日進斗金`，其餘用 `PLAN-editor-3layer.md §4` 的清單，缺字就標 skipped）。

**不做（第一版）：**

- 多人、權限、雲端。（SQLite 已由作者 2026-11-08 放開：localhost 後端可用，
  最終併 Wails3；第一版仍先用 JSON store，需要時再換，見 decisions D7。）
- 全 21k 字的虛擬滾動（先做搜尋＋最近）。
- 字型匯出（`.ttf`）、KAGE 編輯、`merge`／`clip`。
- 自動排版求解器；只做手動拖動＋delta。

## 5. 架構（建議）

```
pinxing-editor/
├─ src/
│  ├─ data/            # 唯讀適配器（strokes.bin / components / DECOMP / proportions / base）
│  ├─ model/           # Glyph / Component / Stroke / Patch / Scope
│  ├─ render/          # SVG：中心線＋半寬 → path；部件框；控制點
│  ├─ ui/              # Canvas / LeftPanel / Inspector / Breadcrumb / BottomBar
│  └─ main.ts
├─ scripts/
│  ├─ accept.ts        # 10 字載入、選取、拖動、undo、patch 重播
│  └─ check-upstream.ts# 確認上游 mtime/狀態沒被寫
├─ data/patches/       # 變形層（JSON，append-only）
└─ public/
```

### 5.1 Data adapter

- `loadIndex()`：讀 `strokes.index.json`（lazy；不要一次解 5 MB）。
- `readGlyph(cp)`：依 offset 從 `strokes.bin` 解出 `Stroke[]`（每筆 `points:[{x,y,w}]`）。
- `loadComponents()`：只讀 `tree`／`leaves`；**box 轉換**：
  `x0 = b[0]*1024`、`x1 = b[2]*1024`、`y1 = (1-b[1])*1024`、`y0 = (1-b[3])*1024`。
- `loadDecomp()`：`data/dev/DECOMP.json`（dev fixture）優先；有就用它的 `strokes`，沒有才 fallback `components.json`。
- `loadProportions()`：jsonl → `Map<component, {sx,sy,relx,rely}[]>`。
- `loadBase()`：`base.json` 的 `chars`；給例子／合文用。

### 5.2 Renderer

- MVP：每筆畫成一條 `<path>`：中心線 polyline、`stroke-width = 2*halfwidth`、`stroke-linecap="round"`。
  這不是最終筆形，但足夠選取與拖動。
- D3 可換成 `pinxing.ts` 的 `glyphPolygons()`（先確認 `Stroke` 形狀相同；不同就寫一個 100 行的
  `outlineOf(stroke)`，用半寬沿法線偏移）。
- 座標：SVG `viewBox="0 0 1024 1024"`，`transform="translate(0,1024) scale(1,-1)"` 把 y 向上翻正。

### 5.3 UI

- **左**：例子／搜尋（碼位、部件）／最近／部件清單（樹）。
- **中**：SVG 畫布；三層 z-order：筆畫 < 部件框 < 控制點。
- **右**：Inspector；依選取層顯示：
  - stroke：控制點列表、每個 anchor 的 `u,w`、筆型；
  - component：`x0,y0,x1,y1`、`sx,sy`、`relx,rely`、來源字；
  - glyph：字身框、部件間距、全域縮放。
- **底**：impact count、undo/redo、A/B、存 patch、匯出 SVG/PNG。

### 5.4 Patch / scope

```ts
type Scope =
  | { kind: "stroke"; cp: number; stroke: number }
  | { kind: "component"; cp: number; path: number[] }
  | { kind: "glyph"; cp: number }
  | { kind: "global" };

type Patch = {
  id: string; ts: string;
  scope: Scope;
  op: "move-point" | "set-width" | "move-box" | "scale-box" | "set-style";
  target: unknown; before: unknown; after: unknown;
  note?: string;
};
```

- 套用順序：`stroke > component > glyph > global`（越 specific 越優先）。
- impact count：由 scope 反查（component → 所有含該部件的字；global → 全部）。
- 存 `data/patches/<ts>-<id>.json`；載入時按 `ts` 重播；undo/redo 用 stack，不刪檔。

## 6. 互動規格（最小）

| 操作 | 結果 |
| --- | --- |
| 點字 | 選 glyph；顯示部件框 |
| 點部件框 | 選 component；高亮它的筆；breadcrumb 更新 |
| 點筆 | 選 stroke；顯示控制點與寬度曲線 |
| 拖部件框角 | 改 `box`（位置＋縮放）；即時重算該部件的筆 |
| 拖控制點 | 改該點 `(x,y)`；中心線更新 |
| 拖寬度錨點 | 改該點 `w`；寬度剖面更新 |
| scope 切換 | 預覽只作用在選定 scope；底列顯示 impact |
| A/B | 按住 `\` 或 toggle：顯示 patch 前／後 |
| undo/redo | `Ctrl+Z`／`Ctrl+Shift+Z`；≥20 步 |
| 存檔 | 寫 patch JSON；重載後可重播 |

## 7. 里程碑（5 個工作天）

| 日 | 交付 | 驗收 |
| --- | --- | --- |
| **D0（0.5d）** | repo scaffold、data adapter、單字 render、碼位搜尋 | `bun run dev`；輸入 `908F` 出圖 <1s |
| **D1（1d）** | 部件 overlay、樹／清單、選取同步、breadcrumb | 點部件→筆高亮；點筆→部件高亮 |
| **D2（1d）** | 拖部件框、scope、patch、undo/redo、impact | 拖一個框→預覽變；undo 回到原樣；impact 數字正確 |
| **D3（1d）** | 筆畫控制點、寬度錨點、stroke/component scope、A/B | 拖一個點→只動該筆；A/B 看得出差異 |
| **D4（0.5d）** | 5 個例子＋patch 存/讀、SVG/PNG 匯出、demo | 重開頁→patch 重播；上游檔案 mtime 不變 |
| **D5（0.5d）** | 打磨、acceptance script、README | `bun run accept` 全綠 |

## 8. 驗收腳本（`scripts/accept.ts`）

1. 載入 10 個字（5 個 boxfit＋5 個例子；缺字記 skipped，不 FAIL）。
2. 每個字：glyph→component→stroke 選取，breadcrumb 正確。
3. 對 `6C87` 的 `氵` 拖 box +10；預覽更新；undo 後 bbox 回到原值。
4. 對 `857E` 的 `雨` 拖一個控制點；只該筆變；A/B 有差異。
5. 存 patch、重載、重播；state 與存檔前相同。
6. 檢查 `D:\2026\pinxing\data\cjk-strokes` 的 mtime 與 `git status --porcelain` 沒變。
7. 全部 console error = 0。

## 9. 風險與 fallback

| 風險 | fallback |
| --- | --- |
| `components.json` 的 `strokes` 分組錯 | 5 個字用 `DECOMP.json`；其他字允許手動「重新分組」按鈕（只存 patch） |
| `components.json` 的 box 是 0..1 y-down | 統一在 adapter 轉 1024 y-up；寫單元測試 |
| `glyphPolygons` 的 `Stroke` 形狀不相容 | 先用簡單 `stroke-width` renderer；D3 再換 outline |
| 21k 字太大 | 只做搜尋＋最近 20 字；lazy parse |
| 部件重疊被誤判 | 編輯器**不**強制 `gap>=0`；交錯／包圍允許重疊，顯示 `overlap` |
| 上游被寫入 | `scripts/check-upstream.ts` 比對 mtime／git status；CI 擋 |

## 10. 第一個 commit 的三步

1. `bun create vite`（或 `bun init`）＋ TS；建立 `src/data/`，先讀 `strokes.index.json` 與 `strokes.bin` 的 `908F`，畫出 22 筆。
2. 接 `components.json`，把 `908F` 的部件框畫上去（注意 0..1 y-down → 1024 y-up）。
3. 做點選＋breadcrumb；先不做拖動。這三步過了，再開 D2。
