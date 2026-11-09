# data/dev/ — dev fixture（**不是穩定版**）

從母區 `D:\2026\pinxing\out/boxfit/` **複製**而來（2026-11-08），只當範例／fixture；
不列入 `stable-manifest.json`。母區這份會隨實驗變動，**不要直接讀上游 out/**。

| 檔 | 內容 | key 格式 |
| --- | --- | --- |
| `DECOMP.json` | 5 個已修好筆號的分解（5BBC／6174／6C87／857E／8FCD） | **hex** 碼位 |
| `proportions.jsonl` | 每字每葉比例（一行一字） | hex |
| `boxfit/<cp>.json` | 單字已調好的 box（1024 y-up）、ratio、best_iou | 檔名 hex |

規則見 `docs/STABLE-INPUTS.md` §2 與 `docs/decisions.md` D3。
若這些被 promote 成穩定版，才由母區 manifest 新增條目。
