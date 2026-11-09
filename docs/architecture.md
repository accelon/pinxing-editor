# architecture — 這張圖的主張（給對照）

> 圖：`docs/architecture.png`（1600×1000）；可編輯來源：`docs/architecture.svg`。
> 這頁不是再畫一次，是列「圖必須表達什麼」。別的 agent 畫完架構圖，可以逐條對照。

## 1. 三個邊界

1. **上游穩定版（綠）**：`D:\2026\pinxing` 的 `data/cjk-strokes/`、`lib/`、`src/pinxing.ts`，
   入口是 `stable-manifest.json`。**只讀**。
2. **開發版（橘虛線）**：`out/boxfit/`、`out/compose/work/`、`research/`、`tools/`。
   editor **不直接讀**；需要範例就 copy 到 `data/dev/`。
3. **editor（藍）**：只寫自己的 `data/patches/`、`data/macros/`、`data/dev/`。
   **沒有任何箭頭從 editor 指回上游**。

## 2. 節點

| 區 | 節點 | 職責 |
| --- | --- | --- |
| 上游 | `stable-manifest.json` | 版本＋sha；唯一入口 |
| 上游 | `data/cjk-strokes/` | `strokes.bin`、index、`components.json`、build-report |
| 上游 | `lib/lib-cjk-all.bin.gz` | KAGE 字形庫 |
| 上游 | `src/pinxing.ts` | KAGE→SVG 描繪器（Apache-2.0） |
| 上游 | `out/`（dev） | boxfit、合文 macro/state；**不直接讀** |
| editor | Data adapter | manifest gate；sha 比對；只載入穩定檔 |
| editor | Core model | Glyph → Component → Stroke；stable id |
| editor | SVG renderer | centerline＋half-width；y-up 翻轉 |
| editor | UI | 三層同步、breadcrumb、scope、impact、undo/redo、A/B |
| editor | Macro recorder | action＋before/after＋scope＋note／decision；append-only |
| editor | Replay engine | strict/best-effort、checkpoint、seek、drift/rebase |
| editor | Patch / Macro store | `data/patches/`、`data/macros/`；JSONL；不寫上游 |
| 輸出 | compile | editor macro → `ops-*.macro` |
| 輸出 | `macro_runner.py` | machine playback；state／receipt |
| 輸出 | 輸出 | state sha、PNG/GIF、並排圖 |
| 輸出 | verify / accept | 上游 mtime／git status 不變；回報作者 |
| 人 | 作者 | 看圖、拖動、accept／reject |

## 3. 邊（方向很重要）

```text
stable-manifest ──sha gate──▶ Data adapter
stable data ────read-only───▶ Data adapter
out/ (dev) ──copy→data/dev──▶ Data adapter        （虛線；不是直接讀）
Data adapter ──▶ Core model
Data adapter ──▶ SVG renderer
Core model ◀──▶ SVG renderer
Core model / SVG renderer ──▶ UI
UI ──pointerup──▶ Macro recorder
UI ──undo/seek──▶ Replay engine
Macro recorder ◀──actions──▶ Replay engine
Macro recorder / Replay engine ──▶ Patch / Macro store
Patch / Macro store ──compile──▶ ops-*.macro
ops-*.macro ──▶ macro_runner.py ──▶ state/receipt ──▶ 輸出
輸出 ──▶ verify / accept ──▶ 作者
作者 ◀──操作/判斷──▶ UI
```

## 4. 不變量（圖上必須看不出矛盾）

1. **沒有 editor → 上游的箭頭**；上游只有 read-only／copy 進來的箭頭。
2. **沒有 out/ → adapter 的實線**；只有虛線「copy → data/dev」。
3. **macro 不是只錄滑鼠**：每個 action 有 before/after、scope、note、decision、status。
4. **replay 先比 manifest 版本／sha**；不符就 drift，不靜默套用。
5. **compiled macro 是 machine 的證據**；editor macro 是人的判斷來源，兩者都要留。
6. **patch/macro append-only**；undo/redo 不改歷史。

## 5. 對照清單（別人的圖少了這些＝理解不一致）

- [ ] 有 stable manifest 的 sha gate
- [ ] 有「穩定版 vs 開發版」兩種顏色／線型
- [ ] 有「editor 不寫上游」的紅線
- [ ] 有 Data adapter／Core model／Renderer／UI 四塊
- [ ] 有 Macro recorder／Replay engine／Patch-Macro store
- [ ] 有 compile → `ops-*.macro` → `macro_runner` → state sha
- [ ] 有 author 的操作與 accept/reject
- [ ] 有 replay 的 drift/rebase
- [ ] 沒有把 `out/boxfit` 當穩定版直接接進去
