/**
 * self-explaining-tour 編譯設定。
 * 劇本在 tours/*.tour；產物 src/tour-data.ts（進版控，內容是編譯後的 base64 macro）。
 * 改劇本後要重跑：bun run tour:build（CI 用 tour:check 抓過期）。
 */
import { defineTourConfig } from "./src/tour/compiler";

export default defineTourConfig({
  tourDir: "./tours",
  outFile: "./src/tour-data.ts",
  templateFile: "./index.html", // 靜態檢查：劇本裡的 #id 必須存在
  formatImport: "./tour/format",
  appName: "pinxing-editor",
  // `呼叫` allow-list：對齊 main.ts 的 tourCall()
  callNames: ["dragBox", "dragPoint", "setAb"],
  // `api:` 條件 allow-list：對齊 window.__ed.snap() 的頂層欄位
  apiKeys: [
    "ready",
    "cp",
    "selection",
    "scope",
    "canUndo",
    "canRedo",
    "dirty",
    "patchCount",
    "applied",
    "ab",
    "status",
  ],
});
