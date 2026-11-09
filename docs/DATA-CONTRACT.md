# DATA-CONTRACT — 上游穩定資料的格式（唯讀）

> 這份是 `pinxing-editor` 讀 `D:\2026\pinxing` 的契約。**不要猜格式**；以下都是實際檔案。
> 座標一律：**字型單位 1024、y 向上、基線 y=0**（除非標明 200 或 0..1）。

## 0. 穩定 vs 開發

- **穩定版**：§1–§4＋`src/pinxing.ts`；入口 `D:\2026\pinxing\stable-manifest.json`，啟動比對 sha。
- **開發版**：§5–§9（`out/boxfit/`、`out/compose/work/`）；**不要直接讀**，必要時複製到
  `pinxing-editor/data/dev/` 並標 `dev fixture`。

## 1. `data/cjk-strokes/strokes.bin`

二進位，little-endian：

```
1 byte   strokeCount
for each stroke:
  1 byte   pointCount
  for each point:
    int16  x
    int16  y
    uint8  halfWidth
```

- 一個字一個 record；`strokes.index.json` 給 offset。
- 點是**中心線**上的點；`halfWidth` 是半寬（不是全寬）。
- y 向上；字身可以低於基線（例：`不` 到 -92、`月` 到 -84）。

讀法（Python 參考）：

```python
p = idx["glyphs"][str(cp)][0]
n = blob[p]; p += 1
for _ in range(n):
    m = blob[p]; p += 1
    pts = []
    for _ in range(m):
        x, y, w = struct.unpack_from("<hhB", blob, p); p += 5
        pts.append((x, y, w))
```

## 2. `data/cjk-strokes/strokes.index.json`

```json
{
  "upem": 1024,
  "px": 256,
  "source": "…",
  "glyphs": {
    "19968": [0, 1],
    "19969": [27, 2]
  }
}
```

- key 是**十進位**碼位字串（`19968` = U+4E00）。
- value `[offset, count]`；offset 是 `strokes.bin` 的 byte offset。
  **第二欄不要依賴**（不同版本可能是 component 數或別的東西）；筆數以 `strokes.bin` 的第一個 byte 為準。

## 3. `data/cjk-strokes/components.json`

```json
{
  "source": "IDS @apparent（unicode-cjk-ids/All.txt）＋ 版面規則推算",
  "coord": "字身 0..1，左上原點、y 向下",
  "glyphs": {
    "37007": {
      "tree": ["⿺", ["辶", "羅"]],
      "leaves": [
        {"path": [0], "char": "辶", "box": [0.0, 0.45, 0.6, 1.0], "strokes": [8, 9, 20, 21]},
        {"path": [1, 0], "char": "⺲", "box": [0.15, 0.0, 1.0, 0.375], "strokes": [0, 1, 2, 3]}
      ]
    }
  }
}
```

- `glyphs` key 是**十進位**碼位字串（`"37007"` = U+908F），與 `strokes.index.json` 一致；
  2026-11-08 實測更正（本節舊例誤寫 hex `"908F"`）。注意 `out/boxfit/DECOMP.json` 才是 hex key。

- `box` 是 **0..1、左上原點、y 向下**；編輯器要轉成 1024 y-up：
  `x0=b[0]*1024`、`x1=b[2]*1024`、`y1=(1-b[1])*1024`、`y0=(1-b[3])*1024`。
- `strokes` 是**不可信**的（中心點落框法會把別人的筆吃進來；例：`沇` 的氵被塞 5 筆、`蕾` 的艹被塞 10 筆）。
  5 個已修好的字用 `out/boxfit/DECOMP.json`；其他字先顯示 warning，允許手動重分組（只存 patch）。

## 4. `data/cjk-strokes/build-report.json`

```json
{
  "method": "assembled",
  "font": "C:\\Windows\\Fonts\\kaiu.ttf",
  "px": 256,
  "stats": {"glyphs": 21204, "strokes": 273714, "...": "..."},
  "glyphs": {
    "19968": {"ch": "一", "components": 1, "strokes": 1, "npts": [5]}
  }
}
```

- 每字 `strokes` 是**總筆數**；`components` 是 composite 的 piece 數（不是部件樹的葉數）。

## 5. `out/boxfit/DECOMP.json`（5 個已修好的字）

```json
{
  "6C87": {
    "char": "沇",
    "tree": ["⿰", ["氵", "允"]],
    "leaves": [
      {"char": "氵", "path": [0], "strokes": [0, 1, 2]},
      {"char": "允", "path": [1], "strokes": [3, 4, 5, 6]}
    ]
  }
}
```

- key 是 **hex** 碼位（`6C87`）。
- 這份是**分解的單一真相**（筆號已修好）；編輯器對這 5 個字用它，不要用 `components.json` 的 `strokes`。

## 6. `out/boxfit/<cp>.json`（單字比例）

```json
{
  "cp": "6C87",
  "char": "沇",
  "tree": ["⿰", ["氵", "允"]],
  "leaves": [
    {
      "char": "氵", "path": [0], "strokes": [0, 1, 2],
      "box": [116, -71, 392, 652],
      "box_kind": "ink",
      "natural_box": [116, -71, 392, 652],
      "ratio": {"sx": 0.2695, "sy": 0.5648, "relx": -0.252, "rely": -0.073},
      "trials": 7, "best_iou": 1.0, "confidence": 1.0
    }
  ],
  "best": {"iou": 1.0, "candidate": "natural", "trials": 7, "bbox_diff": 0},
  "checks": {"coverage": true, "inside_em": true, "sibling_gaps": [-141]}
}
```

- `box` 是 1024 y-up（不是 0..1）。
- `box_kind`：`"ink"`（自然墨跡框）或 `"slot"`（版面框）。
- `ratio`：相對父框的比例，`sx=葉寬/父寬`、`sy=葉高/父高`、`relx/rely` 相對父中心。
- `sibling_gaps` 可以為負（交錯／包圍允許重疊）；編輯器不要強制 `gap>=0`。

## 7. `out/boxfit/proportions.jsonl`

一行一個字：

```json
{"cp":"6C87","char":"沇","leaves":[{"char":"氵","ratio":{"sx":0.2695,"sy":0.5648,"relx":-0.252,"rely":-0.073},"box":[116,-71,392,652]}],"best_iou":1.0,"candidate":"natural"}
```

- 之後的「部件比例表」由此累積；key 建議 `char + op + slot`。

## 8. `out/compose/work/base.json`

```json
{
  "format": "pinxing.base/1",
  "upem": 1024,
  "source": "out/noto-vf/cjk-strokes",
  "strokes_index": "strokes.index.json",
  "chars": {
    "62DB": {
      "char": "招",
      "strokes": [[[118,446,14],[174,438,19],[386,486,25]], "…"]
    }
  }
}
```

- key 是 **hex** 碼位。
- `strokes` 是**已展開**的筆（每筆 `[[x,y,w],…]`），可直接畫；不必再讀 `.bin`。

## 9. `out/compose/work/state.json`（合文終態）

```json
{
  "cp": "CANVAS",
  "char": "canvas",
  "tree": null,
  "strokes": [[[x,y,w], "..."]],
  "components": [{"char": "日", "path": [0], "strokes": [0,1,2,3], "box": [60,700,420,1000]}],
  "pieces": [{"name": "日", "box": [60,700,420,1000], "strokes": [0,1,2,3]}]
}
```

- `pieces` 只有 `canvas` 模式才有；單根字是 `[]`。
- `components` 的 `box` 是 1024 y-up。

## 10. `ops-*.macro`（合文的單一真相）

編輯器只讀，不執行。常用命令：

```
canvas
place <名字> x0 y0 x1 y1
extend <sN> <上|下|左|右> <cell.*|box.*|c部件.*|數字>
open <字>
make <名字> <op> <部件...>
replace <舊> <新>
setwidth <s> <w>
point <s> <i> <dx> <dy>
anchor <s> <u> <w>
assert strokes g == N
render -o <path>
save <path>
```

- `place` 的框是 1024 y-up；`canvas` 是 1024×1024、基線 0。
- `extend` 只改該筆最後一個控制點，不改中間點／半寬。

## 11. 不變量（編輯器要守住）

1. **核心唯讀**：上游 `.bin`／`components.json` 不改；所有編輯存 `pinxing-editor/data/patches/`。
2. **id 不用 index**：`glyph:<cp>`、`component:<cp>:<path>`、`stroke:<cp>:<index>`。
3. **patch append-only**：不刪檔；undo/redo 用 stack。
4. **框的座標**：編輯器內部一律 1024 y-up；只在 adapter 轉 `components.json` 的 0..1 y-down。
5. **重疊合法**：交錯／包圍的兄弟框可以重疊；不要用 `gap>=0` 當編輯器硬規則。
