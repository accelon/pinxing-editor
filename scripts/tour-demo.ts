/**
 * 演示播放驗證（`bun run tour:demo` = node scripts/tour-demo.ts）。
 *
 * 自動播完 demo 導覽（所有模擬操作由播放器執行，不用人一個一個按）：
 *   - 錄影 → out/tour-demo.webm；每場景截圖 → out/tour-scene-N.png
 *   - 斷言：tourState().failed 為空、全部場景播完、聚光燈與目標重疊、
 *     拖曳真的產生 patch、存檔後重載重播 sha 相同、console error = 0。
 *
 * 用 node 跑（bun + playwright CDP pipe 有問題，同 accept）；dev server 自起自收。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext } from "playwright-core";

const PROJECT = path.resolve(process.cwd());
const URL = "http://127.0.0.1:5173";
const OUT = path.join(PROJECT, "out");

let failed = 0;
const logLines: string[] = [];
const pass = (msg: string) => {
  logLines.push(`PASS  ${msg}`);
  console.log(`PASS  ${msg}`);
};
const fail = (msg: string) => {
  failed++;
  logLines.push(`FAIL  ${msg}`);
  console.log(`FAIL  ${msg}`);
};
const info = (msg: string) => {
  logLines.push(`      ${msg}`);
  console.log(`      ${msg}`);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitServer(timeoutMs = 20000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`${URL}/__stable/manifest`);
      if (res.ok) return true;
    } catch {
      /* 還沒起來 */
    }
    await sleep(250);
  }
  return false;
}

/** 乾淨化：刪既有 patch 檔，讓演示從頭開始（與 accept 同規則）。 */
async function cleanPatches(): Promise<void> {
  const { readdir, rm } = await import("node:fs/promises");
  const dir = path.join(PROJECT, "data/patches");
  try {
    for (const f of await readdir(dir)) {
      if (f.endsWith(".jsonl")) await rm(path.join(dir, f), { force: true });
    }
  } catch {
    /* 目錄不存在就略過 */
  }
}

type TourSnap = {
  id: string | null;
  scene: number;
  scenes: number;
  step: number;
  steps: number;
  phase: string;
  waitKind: string;
  note: string;
  point: string | null;
  failed: { scene: number; step: number; msg: string }[];
  spot: { visible: boolean; overlapTarget: boolean };
  bubble: { visible: boolean; text: string; where: string };
};

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  let server: ChildProcess | null = null;
  const serverUp = await fetch(URL + "/__stable/manifest")
    .then((r) => r.ok)
    .catch(() => false);
  if (!serverUp) {
    console.log("起 dev server（vite）…");
    server = spawn("bunx", ["vite"], { cwd: PROJECT, shell: process.platform === "win32", stdio: "pipe" });
    if (!(await waitServer())) {
      fail("dev server 起不來（5173）");
      server.kill();
      process.exit(1);
    }
  }
  pass("dev server 5173 就緒");

  await cleanPatches();

  const consoleErrors: string[] = [];
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  let context: BrowserContext;
  try {
    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: path.join(OUT, "tour-video"), size: { width: 1440, height: 900 } },
    });
  } catch {
    // 沒裝 playwright ffmpeg 就只截圖（npx playwright install ffmpeg 可開錄影）
    info("錄影不可用（缺 ffmpeg），本輪只截圖");
    context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  }
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__ed?.ready === true, undefined, { timeout: 15000 });
    pass("頁面 ready（window.__ed）");

    // 開演示：🦮 入口（單一劇本 → 直接播 demo）
    await page.click("#tourEntry");
    await page.waitForFunction(() => window.__tourState().id === "demo", undefined, { timeout: 5000 });
    pass("導覽啟動（demo）");

    // ---- 自動播：停→按空白；場景完→下一個；失敗停住→略過（failed 統一在最後斷言）
    // 錄影節奏：每個「停」留 3 s、場景間留 2.5 s 給觀眾閱讀，免得影片跑太快。
    const DWELL_TAP = 3000;
    const DWELL_NEXT = 2500;
    let lastWaitKey = "";
    let waitSince = 0;
    const shotDone = new Set<number>();
    let overlapBad = 0;
    let overlapChecked = 0;
    let sawDone = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 240000) {
      const st = (await page.evaluate(() => window.__tourState())) as unknown as TourSnap;
      const waitKey = `${st.scene}:${st.step}:${st.waitKind}`;
      if (waitKey !== lastWaitKey) {
        lastWaitKey = waitKey;
        waitSince = Date.now();
      }
      if (st.phase === "done") {
        sawDone = true;
        await page.screenshot({ path: path.join(OUT, "tour-scene-end.png") });
        break;
      }
      if (st.waitKind === "tap" || st.waitKind === "next") {
        // 穩定時刻：每場景留一張截圖；順便查聚光燈有沒有對準目標
        if (st.scene >= 0 && !shotDone.has(st.scene)) {
          shotDone.add(st.scene);
          await page.screenshot({ path: path.join(OUT, `tour-scene-${st.scene + 1}.png`) });
        }
        if (st.point && st.spot.visible) {
          overlapChecked++;
          if (!st.spot.overlapTarget) overlapBad++;
        }
      }
      if (st.waitKind === "tap" && Date.now() - waitSince >= DWELL_TAP) {
        await page.keyboard.press(" ");
      } else if (st.waitKind === "next" && Date.now() - waitSince >= DWELL_NEXT) {
        await page.click("#tourNext");
      } else if (st.waitKind === "pause") {
        // 失敗停住（例如找不到元素）：略過這步繼續跑，failed 最後統計
        info(`步驟失敗停住，略過：${st.note}`);
        await page.click("#tourSkip");
      }
      await sleep(150);
    }
    info(`演示總時長 ${((Date.now() - t0) / 1000).toFixed(0)} s（含場景間閱讀停頓）`);

    const fin = (await page.evaluate(() => window.__tourState())) as unknown as TourSnap;
    if (sawDone) pass(`全部場景播完（${fin.scenes} 場景）`);
    else fail(`240 s 內沒播完（停在 scene=${fin.scene} step=${fin.step} wait=${fin.waitKind}）`);

    if (fin.failed.length === 0) pass("tourState().failed = []（無失敗步驟）");
    else {
      fail(`導覽有 ${fin.failed.length} 個失敗步驟`);
      for (const f of fin.failed.slice(0, 10)) info(`scene ${f.scene + 1} step ${f.step + 1}：${f.msg}`);
    }

    if (overlapChecked > 0 && overlapBad === 0) pass(`聚光燈對準目標（抽查 ${overlapChecked} 次全重疊）`);
    else if (overlapChecked === 0) fail("沒有抽查到任何聚光燈重疊（檢查停太少？）");
    else fail(`聚光燈與目標不重疊 ${overlapBad}/${overlapChecked} 次`);

    // ---- 狀態斷言：拖曳真產生 patch；存檔後重播 sha 相同 ----------------------
    const snap = await page.evaluate(() => window.__ed.snap());
    if (snap.cp !== null && /^6C87$/i.test(snap.cp.toString(16))) pass(`演示字 U+${snap.cp.toString(16).toUpperCase()}`);
    else fail(`演示字不對：cp=${snap.cp}`);
    if (snap.patchCount >= 2) pass(`patch 產生（${snap.patchCount} ≥ 2：拖框＋控制點）`);
    else fail(`patch 只有 ${snap.patchCount} 個（期望拖框＋控制點各一）`);
    const changed = await page.evaluate(() => window.__ed.changedStrokes());
    if (changed.length >= 1) pass(`有筆畫被改（changed=[${changed.join(",")}]）`);
    else fail("changedStrokes() 是空的（拖曳沒生效）");

    const sha1 = await page.evaluate(() => window.__ed.stateSha());
    await page.evaluate(() => window.__ed.reload());
    await sleep(150);
    const sha2 = await page.evaluate(() => window.__ed.stateSha());
    if (sha1 === sha2 && sha1.length > 0) pass(`存檔重播 sha 相同（${sha1.slice(0, 12)}…）`);
    else fail(`重播 sha 不符：${sha1.slice(0, 12)}… ≠ ${sha2.slice(0, 12)}…`);

    if (consoleErrors.length === 0) pass("console error = 0");
    else {
      fail(`console error ${consoleErrors.length} 條`);
      for (const e of consoleErrors.slice(0, 10)) info(e);
    }
  } finally {
    const video = page.video();
    await context.close();
    if (video) {
      try {
        const vp = await video.path();
        copyFileSync(vp, path.join(OUT, "tour-demo.webm"));
        pass("錄影 out/tour-demo.webm");
      } catch {
        info("錄影存檔失敗（不影響斷言）");
      }
    }
    await browser.close();
    if (server) server.kill();
  }

  writeFileSync(path.join(OUT, "tour-demo.log"), logLines.join("\n") + "\n", "utf8");
  console.log(failed === 0 ? "\nTOUR DEMO PASS（演示可播，零失敗）" : `\nTOUR DEMO FAIL（${failed}）`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
