# STABLE-INPUTS — editor 只讀穩定版

> 上游 `D:\2026\pinxing` 分成兩層：**穩定版**（`data/`＋`lib/`＋`src/pinxing.ts`）與
> **開發版**（`out/`、`research/`、`tools/`）。這個 repo 只讀穩定版；開發版不進穩定輸入。

## 1. 唯一入口：stable-manifest.json

```text
D:\2026\pinxing\stable-manifest.json
```

啟動時：

1. 讀 manifest。
2. 對每個 `files[]` 比對 `sha256` 與 `bytes`。
3. 不符 → 拒絕載入，顯示「穩定版已變更，請更新 manifest」。
4. 只載入 manifest 列出的檔案；**不要**自己去找 `out/` 裡的檔。

目前 manifest 的檔案：

| role | 路徑 |
| --- | --- |
| strokes | `data/cjk-strokes/strokes.bin` |
| strokes-index | `data/cjk-strokes/strokes.index.json` |
| components | `data/cjk-strokes/components.json` |
| build-report | `data/cjk-strokes/build-report.json` |
| kage-library | `lib/lib-cjk-all.bin.gz` |
| renderer-reference | `src/pinxing.ts`（Apache-2.0） |

## 2. 開發版（不要直接讀）

- `out/boxfit/**`：5 字修正分解、比例、boxfit JSON（實驗；尚未 promote）。
- `out/compose/work/**`：合文 macro／state／receipt／PNG/GIF（每次跑 macro 會變）。
- `research/**`、`tools/**`：舊研究、工具程式。

如果 prototype 真的需要 `DECOMP.json`／`proportions.jsonl` 當範例：

```text
pinxing-editor/data/dev/DECOMP.json
pinxing-editor/data/dev/proportions.jsonl
```

- **複製**進來（不要直接讀上游 `out/`）。
- 檔頭/README 標 `dev fixture`；不列入穩定 manifest。
- 之後若 promote，才由 `D:\2026\pinxing\stable-manifest.json` 新增條目。

## 3. 寫入邊界

這個 repo 可以寫：

- `data/patches/**`（編輯 delta；append-only）
- `data/dev/**`（dev fixture）
- `src/**`、`public/**`、`scripts/**`、`README` 等實作檔

**不能寫**：

- `D:\2026\pinxing\**`（含 `data/`、`out/`、`lib/`、`src/`）
- 上游的 `strokes.bin`／`components.json`／`state.json`／`receipt.json`

## 4. 版本升級

上游穩定版變更時，鯨大大會更新 `stable-manifest.json` 並通知新的 sha。
editor 只認 manifest；不要用 mtime 或檔名猜版本。

## 5. 一句話

**manifest 是唯一入口；`data/`＋`lib/`＋`src/pinxing.ts` 是穩定版；`out/` 是開發版；editor 的編輯只留 `data/patches/`。**
