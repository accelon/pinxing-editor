# decisions — 偏離預設與理由

> 依 `D:\2026\agent-norms\new-workspace-AGENTS.md` §5：偏離 agent-norms 預設時，寫「為什麼」與「什麼情況改回來」。

## D1. 為什麼沒有固定的「成品路徑」

- 預設：成品 copy 到決策表寫的固定位置（不是 `out/`／`build/`／`dist/`）。
- 這一區是**編輯器原型**，產出是原始碼＋可重跑的 dev server，不是一份資料成品。
- 所以：`src/` 是成品；build／preview 產物放 `out/`（不進版控）。
- 改回來的條件：如果之後要交付靜態站或桌面包，再在 `AGENTS.md` §1 寫固定成品路徑。

## D2. 為什麼穩定版用 manifest，而不是 copy 一份資料

- 預設：新工作區的來源放 `raw/` 或 `data/`，唯讀。
- 這裡的穩定版是母區的 `data/cjk-strokes/`（12 MB＋），copy 會 drift，也會讓 git 變大。
- 所以：只讀母區，入口是 `D:\2026\pinxing\stable-manifest.json`；啟動比對 sha。
- 改回來的條件：如果母區不再提供 manifest，或需要離線打包，再 copy 到 `data/stable/` 並 freeze sha。

## D3. 為什麼 dev fixture 要 copy 到 `data/dev/`

- `out/boxfit/`、`out/compose/work/` 是開發版，會隨實驗變動；直接讀會讓 editor 不穩定。
- 所以：需要範例時 copy 到 `data/dev/`，標 `dev fixture`；不列入穩定 manifest。
- 改回來的條件：該 fixture 被 promote 成穩定版（母區 `STABLE.md` 流程）。

## D4. 為什麼 macro 是 JSONL，不是二進位

- 作者的判斷要可讀、可 diff、可重播；JSONL 一行一個 action。
- 成本：檔案比二進位大；但 prototype 的 action 數量少（每字 < 100），可接受。
- 改回來的條件：action 數 > 10 萬或需要跨機器同步時，再考慮壓縮／SQLite。

## D5. 為什麼 dev server 內建 stable bridge（vite plugin）

- 瀏覽器不能直接讀 `D:\2026\pinxing`；三個選項：
  1. copy 一份進來 → 會 drift（D2 已否決）；
  2. 放行 vite `server.fs.allow`／`/@fs/` → 等於把整個上游目錄暴露給頁面，破壞「role 白名單」；
  3. **dev server 中介層只轉發 manifest 列出的 role，serve 前比對 sha256**（採用）。
- 效果：唯讀、白名單、sha gate 都在同一道門；頁面拿不到 manifest 以外的路徑。
- 改回來的條件：上游改用 HTTP 提供穩定版，或之後換非 Vite 的 dev server（把 bridge 抽成獨立小 middleware）。

## D6. components.json 的 key 是十進位，不是 hex

- `docs/DATA-CONTRACT.md` §3 原本的例子寫 hex（`"908F"`），2026-11-08 實測
  `glyphs` key 是**十進位**（`"37007"`），與 `strokes.index.json` 一致；已更正文件與 adapter。
- 注意：`out/boxfit/DECOMP.json`（dev fixture）才是 hex key——兩邊不同，取用時別弄混。
- 改回來的條件：上游若把 components.json 改成 hex key（manifest 更新會揭露），同步改 adapter 與本節。

## D7. SQLite／localhost／Wails3（作者 2026-11-08 指示）

- 作者原話：「可以用 SQLite，不一定非要在 File:// 執行，開 localhost 也可以，最後會併入 Wails3。」
- 含義：
  1. **放開**原先「不做 SQLite」的限制（README 限制、FAST-PROTOTYPE §4 已同步改）。
  2. 運行環境就是 localhost dev server（現行 vite 已符合）；**不走 file://**。
  3. 最終成品併入 **Wails3**（Go host ＋ TS frontend，見 agent-norms/yap-software-practice）。
- 因此的架構約束（現在就守）：
  - **資料一律走後端 API**：現在是 vite middleware（`/__stable/*`、`/__store/*`），
    將來換成 Wails3 的 Go handler；瀏覽器端不直寫檔案、不碰資料庫。
  - 前端保持框架無關，storage 介面化（`StoreApi`），JSON 與 SQLite 可替換。
- 第一版預設仍 JSON（patch/macro 量小，D4 的 JSONL 理由仍成立，見 D4）；
  何時換 SQLite：單 session action 數變大、或需要跨字查詢 patch 歷史時。
- 改回來的條件：作者收回指示。

## D8. 不執行上游 macro_runner（編譯產出但不跑）

- MACRO-RECORD-PLAYBACK §10 想用 `macro_runner.py` 對照 state sha，但 runner 會寫
  `out/compose/work/state.json`／`receipt.json`（上游），AGENTS §6 禁止。
- 做法：`compile()` 產出 `ops-*.macro` 存在本區 `out/macros/`（機器可重現的證據），
  **不執行**；等 runner 能在沙箱副本跑時再接。
- 改回來的條件：母區提供唯讀 runner 模式，或作者准在副本目錄跑。
