# AGENTS.md — `pinxing-editor` 工作區

> 這一區只寫「差異」。共用紀律在 agent-norms；字形資料的母區是 `D:\2026\pinxing`。
> 開工前先讀下面 §0 的四份文件，不要從母區整份複製規則過來。

## 0. 先讀（紀律來源）

| 順序 | 文件 | 為什麼 |
| --- | --- | --- |
| 0 | `D:\2026\agent-norms\README.md` | 規範總目；開新工作區的 canonical |
| 1 | `D:\2026\agent-norms\yap-software-practice.md` | 作者預設做法；**§12 背景工作與行程** |
| 2 | `D:\2026\pinxing\AGENTS.md`、`HANDOFF.md`、`STABLE.md` | 母區規則、三角色、穩定版邊界 |
| 3 | 本區 `docs\FAST-PROTOTYPE.md`、`docs\STABLE-INPUTS.md`、`docs\DATA-CONTRACT.md` | 這一區要做什麼、只讀什麼、格式 |

## 1. 這個工作區做什麼

- **產出**：三級編輯器（筆畫 → 部件 → 字）的**快速原型**：開一個字、三層同步選取、
  拖部件框／筆畫控制點、即時預覽、錄製與重播編輯動作（macro）、A/B 對照。
- **給誰用**：作者與 agent，用來調部件比例、檢查筆畫／部件結構；不是字型產品。
- **來源（唯讀）**：`D:\2026\pinxing` 的**穩定版**，入口是
  `D:\2026\pinxing\stable-manifest.json`（版本 `2026-11-08.1`）。
  - 只讀：`data/cjk-strokes/`、`lib/lib-cjk-all.bin.gz`、`src/pinxing.ts`。
  - **不讀**：`out/boxfit/`、`out/compose/work/`、`research/`、`tools/`（那是開發版）。
  - 需要 dev fixture 時，**複製**到本區 `data/dev/`，檔頭標 `dev`。
- **成品位置**：本區原始碼（`src/`）＋可重跑的 dev server；build/preview 產物放
  `out/`（**不進版控**）。這一區沒有獨立的資料成品。
- **母工作區**：`D:\2026\pinxing`。

## 2. 共用程式（不要重寫一份）

| 用途 | 用哪一個 |
| --- | --- |
| 字形筆畫資料 | `D:\2026\pinxing\data\cjk-strokes\`（經 stable manifest） |
| KAGE→SVG 描繪器 | `D:\2026\pinxing\src\pinxing.ts`（Apache-2.0；可 copy 純函式，註明出處） |
| 合文命令／machine playback | `D:\2026\pinxing\tools\compose\macro_runner.py`（唯讀；不修改） |
| 已調好的比例／boxfit | `D:\2026\pinxing\out\boxfit\`（**開發版**；只當 fixture 複製） |
| 角色／bus 規矩 | `D:\2026\pinxing\HANDOFF.md` |

發現共用 helper 有問題，**回母區修**，不要就地分叉；新增等價實作前先問作者。

## 3. 工作流程

```text
① 讀 stable-manifest.json，比對 sha（不符就停）
② 載入 strokes.bin / components.json，畫出一個字
③ 三層選取（字／部件／筆畫）＋ breadcrumb
④ 拖動 → 只產生 delta（patch / editor macro）
⑤ 存 data/patches/ 或 data/macros/；可 undo/redo、A/B
⑥ replay（strict / best-effort）＋ compile 到 ops-*.macro 對照
⑦ 跑 scripts/accept.ts，確認上游 mtime／git status 沒變
```

- 腳本放 `src/`；中間產物與 build 放 `out/`（不進版控）。
- 建置要能**從零重跑**：指令寫在 `README.md` 或 `docs/steps.md`。
- 長跑工作加 timeout，收工前連子行程一起收（`yap-software-practice.md` §12）。

## 4. 版本、發布、記帳

1. 本區版本寫在 `README.md`（例 `0.1.0`）；macro 格式版本寫在
   `docs/MACRO-RECORD-PLAYBACK.md`（`pinxing.editor-macro/1`）。
2. 穩定版版本只認母區 `stable-manifest.json`；**不要**用 mtime 猜版本。
3. 發布／上線只有作者明說才做；原型預設只在本機 `127.0.0.1`。
4. 每次動到穩定版輸入的假設，在 `docs/decisions.md` 記「為什麼、什麼情況改回來」。

## 5. 文件

- 本區 `README.md`：這是什麼、怎麼跑、只讀什麼、限制。
- `docs/WHY-THREE-LAYERS.md`：為什麼漢字不能 per-glyph contour 調；三層的作用域。
- `docs/FAST-PROTOTYPE.md`：5 天里程碑與驗收。
- `docs/DATA-CONTRACT.md`：上游格式與座標轉換（別猜）。
- `docs/STABLE-INPUTS.md`：穩定版 manifest 與 dev fixture 規則。
- `docs/MACRO-RECORD-PLAYBACK.md`：錄製／重播設計。
- `docs/KEYWORDS.md`：術語表。
- 文件、UI、註解用繁體中文；程式識別字用英文。

## 6. 不要做的事

- **不要寫 `D:\2026\pinxing`**：不改 `.bin`、`components.json`、`state.json`、`receipt.json`；
  不跑會寫檔的 macro。
- **不要把 `out/` 當穩定版**：`out/boxfit`、`out/compose/work` 是開發版；要用的話複製到
  `data/dev/` 並標 `dev`。
- **不要為了找資料掃上層目錄**（`D:\2026\`、`D:\`、家目錄）或整個工作區樹；
  先讀 `D:\2026\pinxing\AGENTS.md` 與 `docs/` 索引，真的需要再指定單一檔案。
- **不要引入 GPL 的 `kage-engine`**（含程式碼、翻譯、貼上的片段）。
- 不要 `git add -A`、`git reset --hard`、`git restore .`；不要自動 commit。
- 不要把大檔（build、`node_modules`、截圖、字型）commit 進 git。
- 不要在未經指示時發布或覆寫線上。

## 7. 交接（工作區停用前）

- [ ] `bun install && bun run dev` 能從零跑起來
- [ ] `scripts/accept.ts` 全綠；上游 `git status` 與 mtime 沒變
- [ ] `README.md` 寫清楚「已停用，維護看哪一份」
- [ ] 穩定版版本、macro 格式版本、dev fixture 清單都記在 `docs/`
- [ ] 背景工作與子行程收乾淨
