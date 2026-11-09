# steps — 從零跑起來（給下一個接手的人）

> 這頁是**可重跑**的建置／執行步驟；scaffold 已完成（0.1.0，D0），
> 以下指令皆實測可跑。

## 0. 前置

- Windows 10/11；Bun（`bun --version`）＋ Node 20+（備用）。
- 可以讀 `D:\2026\pinxing`；**不需要**寫入權限。

## 1. 取穩定版（唯讀）

```powershell
# 只讀，不要 copy 進本區（大檔不進 git）
$stable = 'D:\2026\pinxing'
Get-Content "$stable\stable-manifest.json" -Raw -Encoding utf8
```

- 版本目前 `2026-11-08.1`；啟動時比對 `sha256`，不符就停。
- 只讀 `data/cjk-strokes/`、`lib/lib-cjk-all.bin.gz`、`src/pinxing.ts`。
- 需要 `DECOMP.json`／`proportions.jsonl` 當範例 → 複製到 `data/dev/`，標 `dev`。

## 2. 安裝與開發

```powershell
cd D:\2026\pinxing-editor
bun install
bun run dev          # http://127.0.0.1:5173，自動開 908F
```

- dev server 只綁 `127.0.0.1`（vite.config.ts `strictPort`）。
- 瀏覽器資料走 dev server 內的 stable bridge（`/__stable/manifest`、`/__stable/file/<role>`）：
  role 白名單 ＋ serve 前 sha256 比對；`/@fs/` 直讀上游會被擋（403）。
- build 產物放 `out/`（或 Vite 的 `dist/`，但 `dist/` 要進 `.gitignore`；不要 commit）。

## 3. 驗收

```powershell
bun run d0-check     # 已存在：6 檔 sha ＋ 908F 22 筆 ＋ components 樹
bun run accept       # D5 才建：10 字載入、選取、拖動、undo、macro 重播
```

`scripts/accept.ts` 至少做：

1. 載入 10 個字（5 個 boxfit＋5 個例子；缺字記 skipped）。
2. glyph → component → stroke 選取；breadcrumb 正確。
3. 拖 `6C87` 的 `氵` box；undo 回到原值。
4. 拖 `857E` 的 `雨` 控制點；只該筆變；A/B 有差異。
5. 存 macro；重載 strict replay；state sha 相同。
6. `D:\2026\pinxing\data\cjk-strokes` 的 mtime／`git status` 不變。

## 4. 上游沒被寫入

```powershell
git -C D:\2026\pinxing status --porcelain
# 應該是空的；若有，先停手，回報
```

## 5. 交付

- 原始碼在 `src/`；build 在 `out/`（不進版控）。
- 穩定版版本、macro 格式版本、dev fixture 清單寫在 `docs/`。
- 不發布、不 commit／push，除非作者明說。
