# KEYWORDS — 三級編輯器／pinxing 術語表

> 先掃這頁，再看 [`FAST-PROTOTYPE.md`](FAST-PROTOTYPE.md) 與 [`DATA-CONTRACT.md`](DATA-CONTRACT.md)。
> 路徑若沒標，都在上游 `D:\2026\pinxing\`（唯讀）。

## A. 三層與角色

| 關鍵詞 | 一句話 | 在哪 |
| --- | --- | --- |
| **三級編輯器** | 字 → 部件 → 筆畫，三層同步選取／編輯 | 本 repo |
| **glyph（字）** | 一個碼位的最終字形；有字身框、部件、筆畫 | `strokes.bin` |
| **component（部件）** | 字裡的一個部件實例；有 `path`、`box`、葉名 | `components.json`／`DECOMP.json` |
| **stroke（筆畫）** | 中心線＋每點半寬＋筆型；不是輪廓 | `strokes.bin` |
| **breadcrumb** | `邏 ＞ 罒 ＞ 第 3 筆`，可點回上層 | UI |
| **scope（作用域）** | 這次改動作用在筆／部件／字／全域 | patch |
| **impact count** | 這次改動影響幾個字、幾筆 | 底列 |
| **delta／override／patch** | 只記「跟核心的差」，不存副本 | `data/patches/` |
| **core（核心層）** | 不可變、可重現的 `.bin`／`components.json` | 上游 |
| **deform（變形層）** | 可動、可丟的 patch／比例／實驗 | 本 repo |
| **promote** | 把變形層扶正成新核心版本（本原型不做） | 規劃 |

## B. 資料與檔案

| 關鍵詞 | 一句話 | 路徑 |
| --- | --- | --- |
| **strokes.bin** | 筆畫二進位：1B 筆數／1B 點數／每點 `<hhB>(x,y,w)` | `data/cjk-strokes/strokes.bin` |
| **strokes.index.json** | 十進位碼位 → `[offset, count]` | `data/cjk-strokes/strokes.index.json` |
| **components.json** | IDS 樹＋葉；`box` 0..1 左上 y-down；`strokes` 不可信 | `data/cjk-strokes/components.json` |
| **build-report.json** | 每字筆數／component 數 | `data/cjk-strokes/build-report.json` |
| **DECOMP.json** | 5 個已修好的分解（hex key、每葉筆號） | `out/boxfit/DECOMP.json` |
| **proportions.jsonl** | 每字每葉的 `sx,sy,relx,rely`＋框 | `out/boxfit/proportions.jsonl` |
| **boxfit JSON** | 單字 `box`／`ratio`／`best_iou`／`overlaps` | `out/boxfit/<cp>.json` |
| **base.json** | 已展開的筆畫庫；key 是 hex 碼位 | `out/compose/work/base.json` |
| **state.json** | 合文終態；canvas 有 `pieces` | `out/compose/work/state.json` |
| **receipt.json** | macro 執行的逐步 detail／sha | `out/compose/work/receipt.json` |
| **ops-*.macro** | 合文命令的單一真相（canvas/place/extend/...） | `out/compose/work/ops-*.macro` |

## C. 座標與量測

| 關鍵詞 | 一句話 |
| --- | --- |
| **1024 units** | 字型單位；1 em = 1024 |
| **y-up** | 內部座標 y 向上、基線 y=0；SVG 要翻轉 |
| **em box** | `[0,-256,1024,1024]`；`inside em` 的範圍 |
| **centerline** | 筆畫中心線；每點有 `(x,y)` |
| **half-width** | 每點的半寬 `w`；全寬＝`2w` |
| **natural box** | 部件在母字裡的墨跡 bbox（1024 y-up） |
| **slot** | 版面分配給部件的框；可能比墨跡大／會重疊 |
| **box_kind** | `"ink"` 或 `"slot"` |
| **sx/sy/relx/rely** | 子框相對父框的寬高比與中心位移（尺度不變） |
| **overlap** | 兄弟框重疊；交錯／包圍合法，不是 bug |
| **IoU** | 兩張墨跡的交集／聯集；boxfit 的 `best_iou` |
| **200 space** | 舊 baseline 的 200×200 座標；`x*1024/200` 換算，y 要翻 |

## D. 佈局與合文

| 關鍵詞 | 一句話 |
| --- | --- |
| **構形序／拼形序** | 例：`初衤礻`＝初 的 衤→礻；右遞迴的替換鏈 |
| **IDS** | 表意描述序（`⿰⿱⿺…`）；只當結構參考，**不是**這裡的版面演算法 |
| **合文** | 多個部件合成的一個字形（例：招財進寶） |
| **部件實例 vs standalone** | 母字裡的部件可能被壓窄／簡化，≠ 獨立字；要更像就用 `--leaf` 抽實例 |
| **`--leaf <母字>:<葉>:<名字>`** | 把母字裡的某葉原封不動抽成 base 字 |
| **`make`** | 用算子造兩片新字（`make X ⿰ A B`） |
| **`replace`** | 換葉；保留目標名（可能名字≠內容） |
| **`place`** | 把 `g`／`c部件`／`sN`／任何 base 字放進框 |
| **`canvas`** | 把工作區變成 1024×1024 字身，可放多片 |
| **`extend`** | 只改某筆最後一個控制點，延伸到邊界 |
| **M9** | canvas＋extend；`日進斗金` 是 demo，**已決定不再迭代** |
| **M10** | `merge`（共用筆）／`clip`（互裁）；未做 |
| **weight_pow** | `place` 的筆寬補償指數（預設 0.5＝面積律） |

## E. 編輯器／前端

| 關鍵詞 | 一句話 |
| --- | --- |
| **SVG viewBox** | `0 0 1024 1024`；`transform="translate(0,1024) scale(1,-1)"` 翻 y |
| **hit-test** | 點擊判定：筆→線段距離；部件→框；控制點→半徑 |
| **drag handle** | 控制點／框角的可拖點 |
| **anchor** | 寬度剖面的錨點 `(u,w)`；`u` 是沿筆的 0..1 |
| **A/B compare** | 原字 vs 套 patch 後；按住 `\` 或 toggle |
| **undo/redo** | patch stack；≥20 步 |
| **lazy parse** | 只解目前字；不要一次解 21k 字 |
| **stable id** | `glyph:<cp>`／`component:<cp>:<path>`／`stroke:<cp>:<i>` |
| **scope precedence** | `stroke > component > class > glyph > global` |
| **append-only** | patch 只增不刪；undo 用 stack，不刪檔 |

## F. 工具與程式

| 關鍵詞 | 一句話 | 路徑 |
| --- | --- | --- |
| **pinxing.ts** | KAGE 筆段→SVG 的描繪器；可參考 `glyphPolygons()` | `src/pinxing.ts` |
| **macro_runner.py** | 13 命令＋`canvas`／`extend`；執行 `ops-*.macro` | `tools/compose/macro_runner.py` |
| **make-hewen.ps1** | 構形序→PNG/GIF/並排圖的一鍵流程 | `tools/compose/make-hewen.ps1` |
| **capture-baseline.ps1** | 抓 baseline 頁的部件框 | `tools/compose/capture-baseline.ps1` |
| **build_strokes_from_font.py** | kaiu.ttf → `strokes.bin` | `research/noto-vf/tools/`（舊研究） |
| **editor_server.py** | 舊的複核台後端（SQLite＋queue） | `research/noto-vf/tools/editor_server.py` |
| **verify_boxfit.py** | 小千 boxfit 的機械驗收（覆蓋／框／IoU／overlap） | `tools/boxfit/verify_boxfit.py` |
| **HANDOFF.md** | 三角色、bus、任務檔的規矩 | `HANDOFF.md` |

## G. 授權與邊界

| 關鍵詞 | 一句話 |
| --- | --- |
| **Apache-2.0** | pinxing 的授權；可以 copy，但要保留授權與出處 |
| **GPLv3 kage-engine** | **不准**進本 repo（程式碼、翻譯、貼上的片段） |
| **read-only upstream** | `D:\2026\pinxing` 只能讀；不建檔、不改檔、不跑會寫檔的 macro |
| **no core edits** | 不直接改 `.bin`／`components.json`；改動只存 patch |

## H. KAGE／部品 vs 部件

| 關鍵詞 | 一句話 |
| --- | --- |
| **KAGE** | 日本 GlyphWiki 的筆段描述格式；`99` 引用＋筆形基元，強項是幾何與快速造字 |
| **buhin（部品）** | KAGE 的部件引用；以渲染／造字速度為優先，**不保證**構形邊界 |
| **外字／koseki** | 日本戶籍系統的造字需求；KAGE 的歷史背景 |
| **部品 vs 部件** | 部品是渲染單位；部件是構形單位（有身分、有 role、筆有所有權） |
| **`&`／`C`** | KAGE 的匿名部品／佔位；不是可命名的部件 |
| **variant（變體）** | 同一部件的不同位置／筆形；要標 role，不能只當同一個字 |
| **構形序** | 例 `初衤礻`；用替換鏈表達「誰換誰、誰包誰」 |
| **IDS** | 表意描述序；只當結構參考，不是版面演算法 |
| **筆的所有權** | 一筆只能屬於一個部件（或少數共用筆，M10 另議）；KAGE 的 buhin 不保證 |

## I. 字型檔 vs 結構層

| 關鍵詞 | 一句話 |
| --- | --- |
| **字型檔（font file）** | 一套 CJK 常見 5–20 MB；只存 codepoint→glyph→outline |
| **outline（輪廓）** | glyf／CFF 的曲線；字型檔的真相，但不是構形的真相 |
| **glyph ID** | 字型內的整數索引；不是穩定的構形 id |
| **GSUB** | OpenType 的字形替換；glyph-level，不是 component-level |
| **字形結構知識** | 「這個字由哪些部件、什麼角色、什麼比例、哪些筆」；字型檔沒有 |
| **結構感知層** | 字型檔之上、App 之下的 shared layer：character→component→stroke |
| **元件式字型** | 用部件＋比例＋組合成字；同一部件只存一次，跨字／跨 App 共用 |
| **App 層重造** | 每個 App 自己拆字、自己建索引、自己 hard-code 異體；成果不能共用 |

## J. 字母 vs 二維的詞

| 關鍵詞 | 一句話 |
| --- | --- |
| **alphabet** | 字母集；字母本身無語意，語意出現在 word |
| **letter（字母）** | 原子；內部結構是視覺的、任意的 |
| **word（詞）** | 一維序列；語法在字型之外，由排版引擎處理 |
| **二維的詞** | 漢字：部件在二維空間組合，位置本身就是語法 |
| **morpheme（詞素）** | 部件可以是詞素／形符／聲符；不是無意義的筆畫 |
| **形符／聲符** | 例：招＝扌（手，形符）＋召（zhào，聲符） |
| **一維語法** | 字母序列的語法（拼字、詞序） |
| **二維語法** | 漢字的部件位置／包圍／上下／左右 |
| **category error** | 把漢字當字母畫：語意單位（2D word）與字型單位（1D glyph）不一致 |



