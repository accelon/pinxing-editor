# MACRO-RECORD-PLAYBACK — 編輯器的錄製與重播

> 目的：**使用者在 editor 裡的每一次判斷都不要浪費。**
> 不是錄滑鼠軌跡，是錄「語意動作＋作用域＋理由」；可以重播、可以 diff、可以在穩定版更新後重跑。
> 這份是設計，不是實作；實作在 D2–D4。

## 0. 一句話

**錄 action（語意），不是錄 state（快照）；action 有 before/after、scope、note、status；重播是純函式；穩定版變了要能 detect drift，不靜默套用。**

## 1. 五條原則

1. **判斷是一等公民**：每個 action 都有 `note`、`decision`（`try`／`accept`／`reject`）、`tags`。
   被 undo 的嘗試也留著（`status:"undone"`），那是「為什麼不這樣做」的資料。
2. **語意優先**：錄 `move-component-box`／`move-stroke-point`／`set-width`，不錄 mousemove。
   一次拖曳＝一個 action（pointerdown 的 before、pointerup 的 after）。
3. **確定性**：同一份 stable manifest＋同一串 action → 同一個 final state sha。
   不依賴時間、隨機、UI 尺寸、陣列索引。
4. **可讀可 diff**：JSONL，一行一個 action；人可以直接看、git 可以 diff。
5. **append-only**：`macro.jsonl` 只增不改；undo 不改歷史，改 `status` 與 cursor。
   crash 後最多丟最後一個 action。

## 2. 兩層 macro

| 層 | 內容 | 誰用 | 檔案 |
| --- | --- | --- | --- |
| **editor macro** | 語意 action＋scope＋note＋decision | editor／人 | `data/macros/<id>/macro.jsonl` |
| **compiled macro** | `canvas`／`place`／`extend`／`setwidth`／`point`／`anchor`… | `macro_runner.py`／pipeline | `out/…/ops-*.macro` |

- editor macro 是**判斷的來源**；compiled macro 是**機器可重現的成品**。
- 編譯不是唯一真相：若編譯不了（例如 glyph frame 沒有對應命令），editor macro 仍保留，
  編譯器回報 `unsupported`，不靜默丟掉。

## 3. 檔案佈局

```
data/macros/
  2026-11-08T19-40-00Z-6C87/
    macro.jsonl        # append-only actions
    header.json        # stable version / glyph / title / tags
    checkpoints.json   # 每 50 個 action 的 state sha
    result.json        # final state sha / patch sha / summary
    notes.md           # 人寫的長篇理由（可選）
```

- 一個「錄製 session」一個資料夾；可以 branch（`parent`／`from_seq`）。
- `macro.jsonl` 第一行是 `{"type":"header",...}`，之後是 action。
- `result.json` 是最後一次「存檔／accept」的結果；不是每步都寫。

## 4. Schema

### 4.1 header

```json
{
  "type": "header",
  "format": "pinxing.editor-macro/1",
  "id": "2026-11-08T19-40-00Z-6C87",
  "created": "2026-11-08T19:40:00+08:00",
  "stable": {
    "manifest": "pinxing.stable/1",
    "version": "2026-11-08.1",
    "files": {"data/cjk-strokes/strokes.bin": "60bcf484…"}
  },
  "editor": {"version": "0.1.0"},
  "glyph": {"cp": "6C87", "char": "沇"},
  "title": "沇：氵窄一點、允右移",
  "tags": ["boxfit", "high-frequency", "氵"],
  "parent": null,
  "from_seq": null
}
```

### 4.2 action

```json
{
  "type": "action",
  "seq": 1,
  "ts": "2026-11-08T19:40:12+08:00",
  "op": "move-component-box",
  "target": {"kind": "component", "cp": "6C87", "path": [0]},
  "scope": {"kind": "component", "cp": "6C87", "path": [0]},
  "before": {"box": [116, -71, 392, 652]},
  "after": {"box": [110, -70, 390, 650]},
  "note": "氵再窄 2%，讓右邊的允有空間",
  "decision": "try",
  "status": "applied",
  "ui": {"mode": "component", "selection": {"kind": "component", "path": [0]}}
}
```

- `status`：`applied`（目前有效）／`undone`（做過但被 undo）／`discarded`（明確不要）。
- `decision`：`try`（實驗）／`accept`（保留）／`reject`（否決，留理由）。
- `note` 可空，但 `accept`／`reject` 建議必填。
- `ui` 只記 replay 需要的上下文（模式、選取）；不記滑鼠座標、視窗大小。

### 4.3 checkpoint

```json
{"type":"checkpoint","seq":50,"state_sha":"…","ts":"…"}
```

- 每 50 個 action 或每次 accept；seek 時從最近 checkpoint 重播。

### 4.4 result

```json
{
  "type": "result",
  "final_seq": 42,
  "state_sha": "…",
  "patch_sha": "…",
  "compiled_macro_sha": "…",
  "accepted": true,
  "summary": "氵縮 2%、允右移 6；gap 從 -141 到 -135"
}
```

## 5. Ops（第一版）

| op | target | before / after | 說明 |
| --- | --- | --- | --- |
| `select` | glyph/component/stroke | — | 只記上下文；不改 state |
| `move-component-box` | component | `{box}` | 拖框；一個 pointerup 一個 action |
| `scale-component-box` | component | `{box}` | 拖角；可與 move 合併 |
| `move-stroke-point` | stroke | `{index, x, y}` | 拖中心線控制點 |
| `insert-stroke-point` | stroke | `{index, x, y}` | 新增控制點 |
| `delete-stroke-point` | stroke | `{index}` | 刪控制點 |
| `set-width` | stroke | `{u, w}` | 寬度錨點；`u` 0..1 |
| `insert-width-anchor` | stroke | `{u, w}` | 新增寬度錨點 |
| `set-stroke-type` | stroke | `{type}` | 筆型（可選） |
| `set-glyph-frame` | glyph | `{box}` | 字身框（可選） |
| `note` | any | `{text}` | 只記判斷，不改 state |
| `accept` / `reject` | any | `{reason}` | 決策；不改 state |
| `promote` | dev→stable | `{manifest_version}` | 只有鯨大大；editor 不執行 |

> 第一版只做 `move-component-box`、`move-stroke-point`、`set-width`、`note`、`accept`。
> 其他 op 先留 schema，不實作。

## 6. 錄製規則

1. **pointerdown**：記 before（目前 state 的 target）。
2. **pointermove**：只更新預覽，**不錄**。
3. **pointerup**：若有變化，寫一個 action（after）；沒有變化就不寫。
4. **undo/redo**：不改 action 的 before/after；把該 action 的 `status` 改成 `undone`／`applied`，
   並在 `checkpoints` 或 `cursor.json` 記目前 seq。重播預設只套 `applied`。
5. **note/decision**：可以獨立 action，也可以附在編輯 action 上；UI 提供「為什麼」輸入框。
6. **autosave**：每個 action 後 append＋fsync；crash 只丟最後一個 action。
7. **branch**：從某個 seq 開新資料夾，header 記 `parent`／`from_seq`；不覆寫原 macro。

## 7. 重播規則

```ts
replay(macro, {from = 0, to = end, mode = "strict"}): {state, applied, skipped, errors}
```

- **strict**（預設）：先比對 header.stable.version／sha；target 必須存在；before 必須等於目前 state
  （或允許小容差，見 §8）；任何不符就 abort，回報 `drift`。
- **best-effort**：套用能套的；`skipped` 記原因（target 不存在／before 不符／unsupported）。
- **seek(seq)**：找最近 checkpoint，重播到 seq；不線性重跑全部。
- **diff(seqA, seqB)**：只比 target 的 before/after，給人看「這一步動了什麼」。
- **dry-run**：只回報會影響哪些 target／字，不寫入。

## 8. 穩定版變更（drift / rebase）

- header 記 `stable.version`＋每個檔的 sha。
- 重播前：
  1. 版本相同、sha 相同 → 直接跑。
  2. 版本不同但 target 都還在、筆數沒變 → `warn`，可 `best-effort`。
  3. target 不在（component path 消失、stroke index 越界）→ `needs-rebase`；**不靜默套用**。
- rebase UI：列出 `skipped`，讓人重新指到新的 target；成功後寫一個 `rebase` action，
  不改原 action（append-only）。
- 不要用 mtime 判斷版本；只認 manifest 的 `version`／`sha`。

## 9. 編譯成 `macro_runner`（machine playback）

`compile(macro) -> ops-*.macro`：

| editor op | compiled command |
| --- | --- |
| `move-component-box` | `place c<component> x0 y0 x1 y1`（canvas 模式） |
| `move-stroke-point` | `point sN i dx dy`（相對）或 `point sN i x y`（絕對，若支援） |
| `set-width` | `setwidth sN w` 或 `anchor sN u w` |
| `set-glyph-frame` | 無直接命令 → `unsupported`，保留在 editor macro |
| `note` / `accept` | `#` 註解（不影響 state） |

- 編譯後跑 `macro_runner`，比對 `state` sha；這是「machine 也能重現」的證據。
- 編譯失敗不丟 editor macro；回報 `unsupported` 清單。

## 10. 驗收（D2–D4）

1. 錄 10 個 action（含 2 個 undo）→ 關掉 → 重開 → strict replay → `state_sha`＝result。
2. 錄 3 個 `note`／`accept` → 匯出 JSONL → 人可讀；`result.summary` 有理由。
3. 模擬 stable 版本更新（改 manifest 的 version）→ replay 回 `drift`，不靜默套用。
4. 編譯成 `ops-*.macro` → 跑 `macro_runner` → `state` sha 與 editor result 一致。
5. Crash：第 5 個 action 後 kill → 重開 → 前 4 個還在（autosave）。
6. 1,000 個 action：replay < 200 ms；seek(500) < 50 ms（有 checkpoint）。
7. 上游 `data/cjk-strokes` 的 mtime／git status 不變。

## 11. 不做（第一版）

- 不做多人協作／雲端同步。
- 不做影像錄製（video）；只做 action macro。
- 不做自動排版求解器；macro 只重播人的動作。
- 不做 promote；promote 是鯨大大的流程（見 `STABLE.md`）。

## 12. 實作順序

| 步 | 內容 | 產出 |
| --- | --- | --- |
| D2.1 | schema＋append-only writer＋autosave | `macro.jsonl`、`header.json` |
| D2.2 | action apply／undo／redo＋checkpoint | `replay()`、`seek()` |
| D2.3 | strict/best-effort＋drift 偵測 | `drift` 報告 |
| D2.4 | 編譯到 `ops-*.macro`＋`macro_runner` 對照 | `compiled_macro_sha` |

## 13. 關鍵詞

`editor macro`、`compiled macro`、`action`、`before/after`、`scope`、`status`、
`decision`、`note`、`checkpoint`、`seek`、`strict`、`best-effort`、`drift`、`rebase`、
`append-only`、`autosave`、`state sha`、`compiled_macro_sha`、`ops-*.macro`、`macro_runner`。
