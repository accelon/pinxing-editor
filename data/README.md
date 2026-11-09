# data/ — 本區的資料

## 不放

- 上游穩定版的大檔（`strokes.bin`、`components.json`、`lib-cjk-all.bin.gz`）。
  這些留在 `D:\2026\pinxing`，用 `stable-manifest.json` 讀；不要 copy 進來當「最新版」。

## 放

| 路徑 | 內容 | 進版控？ |
| --- | --- | --- |
| `data/dev/` | 從上游 `out/` **複製**的 dev fixture（`DECOMP.json`、`proportions.jsonl` 等），檔頭／README 標 `dev` | 可以（小檔） |
| `data/patches/` | 編輯 delta（JSON，append-only） | 可以（小檔） |
| `data/macros/` | editor macro（`macro.jsonl`／header／result） | 可以（小檔） |

## 規則

- `data/dev/` 不是穩定版；不要當成 contract。
- `data/patches/`、`data/macros/` 是作者的判斷資產；不要刪、不要覆寫，branch 用新資料夾。
- 大檔（>5 MB）、build、截圖不要進 git。
