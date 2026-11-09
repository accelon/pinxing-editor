/**
 * 驗收腳本（bun scripts/accept.ts，或 bun run accept）— FAST-PROTOTYPE §8 七項：
 * 1. 載入 10 個例子（缺字 skipped，不 FAIL）。
 * 2. 每個字：glyph→component→stroke 選取，breadcrumb 正確。
 * 3. 對 6C87 的 氵 拖 box +10；預覽更新；undo 後 bbox 回原值。
 * 4. 對 857E 的 雨 拖一個控制點；只該筆變；A/B 有差異。
 * 5. 存 patch、重載、重播；state 與存檔前相同。
 * 6. 上游 mtime／sha 未變（spawn check-upstream.ts）。
 * 7. 全部 console error = 0。
 *
 * 桌面 Edge（channel msedge，不下載瀏覽器）；自動起 dev server（5173）。
 */

import { spawn, type ChildProcess } from "node:child_process";
import { chromium } from "playwright-core";
import path from "node:path";

const PROJECT = path.resolve(process.cwd());
const URL = "http://127.0.0.1:5173";

let failed = 0;
const pass = (msg: string) => console.log(`PASS  ${msg}`);
const fail = (msg: string) => {
  failed++;
  console.log(`FAIL  ${msg}`);
};
const info = (msg: string) => console.log(`      ${msg}`);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitServer(timeoutMs = 20000): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(`${URL}/__stable/manifest`);
      if (res.ok) return true;
    } catch {
      /*還沒起來 */
    }
    await sleep(250);
  }
  return false;
}

function runBun(script: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn("bun", [script], { cwd: PROJECT, shell: process.platform === "win32" });
    let out = "";
    p.stdout.on("data", (d) => (out += String(d)));
    p.stderr.on("data", (d) => (out += String(d)));
    p.on("close", (code) => resolve({ code: code ?? 1, out }));
  });
}

// 乾淨化：刪既有 patch 檔，讓測試從頭開始
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

async function main(): Promise<void> {
  let server: ChildProcess | null = null;
  const serverUp = (await fetch(URL + "/__stable/manifest").then((r) => r.ok).catch(() => false));
  if (!serverUp) {
    console.log("起 dev server（vite）…");
    server = spawn("bunx", ["vite"], { cwd: PROJECT, shell: process.platform === "win32", stdio: "pipe" });
    server.stdout?.on("data", (d) => process.stdout.write(`[vite] ${d}`));
    server.stderr?.on("data", (d) => process.stderr.write(`[vite] ${d}`));
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
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  try {
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => window.__ed?.ready === true, undefined, { timeout: 15000 });
    pass("頁面 ready（window.__ed）");

    // ---- 1. 載入 10 個例子 ------------------------------------------------
    const ex = await page.evaluate(() => window.__ed.loadExamples());
    if (ex.ok + ex.skipped.length === 10) pass(`例子 10 個全試（ok=${ex.ok} skipped=${ex.skipped.length}）`);
    else fail(`例子數不對：ok=${ex.ok} skipped=${ex.skipped.length}`);
    if (ex.skipped.length > 0) info(`缺字（不 FAIL）：${ex.skipped.map((c) => c.toString(16).toUpperCase()).join(", ")}`);
    if (ex.ok < 6) fail(`ok=${ex.ok} 少於預期（至少 5 DECOMP + 908F）`);

    // ---- 2. 每字三層選取 + breadcrumb --------------------------------------
    const loadedHexs = await page.evaluate(async () => {
      const out: string[] = [];
      // 用例子清單逐一開，開得了就記
      const cps = [0x5bbc, 0x6174, 0x6c87, 0x857e, 0x8fcd, 0x908f, 0x65e5, 0x9032, 0x6597, 0x91d1];
      for (const cp of cps) {
        const ok = await window.__ed.open(cp.toString(16).toUpperCase());
        if (ok) out.push(cp.toString(16).toUpperCase());
      }
      return out;
    });
    info(`可開：${loadedHexs.join(", ")}`);

    let selOk = 0;
    for (const hex of loadedHexs) {
      await page.evaluate((h) => window.__ed.open(h), hex);
      const r = await page.evaluate(() => {
        const s = window.__ed.snap();
        if (s.cp === null) return { ok: false, why: "no cp" };
        // glyph 選取
        window.__ed.pick({ kind: "glyph", cp: s.cp });
        const c1 = window.__ed.crumb();
        // component：取第一個 leaf（用清單第一項點擊更真，但 hook 也行）
        const li = document.querySelector("#leaf-list li");
        if (!li) return { ok: false, why: "no leaf" };
        li.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        const c2 = window.__ed.crumb();
        const s2 = window.__ed.snap();
        if (s2.selection?.startsWith("component:") !== true)
          return { ok: false, why: `selection=${s2.selection}` };
        // stroke：點 hit path。循環點選：可能先選所屬部件，再點同筆進筆畫；最多點 3 次直到選到 stroke。
        // （每次點後 repaint 重建 DOM，需重新 querySelector。）
        let s3: ReturnType<typeof window.__ed.snap> | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          const hit = document.querySelector('path[data-kind="stroke"]');
          if (!hit) return { ok: false, why: "no stroke hit" };
          hit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          s3 = window.__ed.snap();
          if (s3.selection?.startsWith("stroke:")) break;
        }
        const c3 = window.__ed.crumb();
        if (!s3 || s3.selection?.startsWith("stroke:") !== true)
          return { ok: false, why: `sel3=${s3?.selection}` };
        const char = String.fromCodePoint(s.cp);
        const crumbOk =
          c1.includes(char) && c2.includes("＞") && c3.includes("第") && c3.includes("筆");
        return { ok: crumbOk, why: crumbOk ? "" : `crumb1=${c1} crumb2=${c2} crumb3=${c3}` };
      });
      if (r.ok) selOk++;
      else fail(`${hex} 三層選取：${r.why}`);
    }
    if (selOk === loadedHexs.length) pass(`三層選取＋breadcrumb：${selOk}/${loadedHexs.length} 字全對`);

    // ---- 3. 6C87 氵 拖 box +10 ---------------------------------------------
    await page.evaluate(() => window.__ed.open("6C87"));
    const boxBefore = await page.evaluate(() => window.__ed.baseBox([0]));
    if (!boxBefore) {
      fail("6C87 沒有 氵 box（path [0]）");
    } else {
      // 選取 氵（path [0]）
      await page.evaluate(() => window.__ed.pick({ kind: "component", cp: 0x6c87, path: [0] }));
      const pt = await page.evaluate(() => window.__ed.cornerClient([0], "se"));
      if (!pt) {
        fail("6C87 氵 corner handle 不可見");
      } else {
        const before = await page.evaluate(() => window.__ed.box([0]));
        await page.mouse.move(pt.x, pt.y);
        await page.mouse.down();
        // 拖 +10 glyph 單位（換算螢幕 px）
        const dx = await page.evaluate(() => {
          const a = window.__ed.clientPoint(0, 0);
          const b = window.__ed.clientPoint(10, 0);
          return b.x - a.x;
        });
        await page.mouse.move(pt.x + dx, pt.y, { steps: 5 });
        await page.mouse.up();
        await sleep(80);
        const after = await page.evaluate(() => window.__ed.box([0]));
        if (!before || !after) {
          fail("拖 box 後取不到 box");
        } else {
          const grew = after.x1 - before.x1;
          if (grew > 5) pass(`6C87 氵 拖 box：x1 +${grew.toFixed(1)}（預覽即時更新）`);
          else fail(`6C87 氵 拖 box：x1 只 +${grew.toFixed(1)}（期望 ≈10）`);
          const snap = await page.evaluate(() => window.__ed.snap());
          if (snap.patchCount >= 1) pass(`patch 已入列（${snap.patchCount}）`);
          else fail("拖完沒有 patch");

          // undo 回原值
          await page.evaluate(() => window.__ed.undo());
          const undone = await page.evaluate(() => window.__ed.box([0]));
          if (
            undone &&
            Math.abs(undone.x0 - boxBefore.x0) < 0.01 &&
            Math.abs(undone.x1 - boxBefore.x1) < 0.01
          )
            pass("undo 後 bbox 回到原值");
          else fail(`undo 後 bbox 不符：${JSON.stringify(undone)}`);
          // redo 再 undo 回乾淨（讓後面測試乾淨）
          await page.evaluate(() => window.__ed.redo());
          await page.evaluate(() => window.__ed.undo());
        }
      }
    }

    // ---- 4. 857E 雨 拖控制點；只該筆變；A/B 有差異 ---------------------------
    await page.evaluate(() => window.__ed.open("857E"));
    // 雨 = path [1,0]，strokes 4..11（DECOMP）
    const rainStroke = 4;
    await page.evaluate(
      (i) => window.__ed.pick({ kind: "stroke", cp: 0x857e, index: i }),
      rainStroke,
    );
    const cpt = await page.evaluate(
      ([si, pi]) => window.__ed.pointClient(si, pi),
      [rainStroke, 2] as const,
    );
    if (!cpt) {
      fail("857E 雨 stroke 控制點不可見");
    } else {
      const shaBefore = await page.evaluate(() => window.__ed.stateSha());
      const dx = await page.evaluate(() => {
        const a = window.__ed.clientPoint(0, 0);
        const b = window.__ed.clientPoint(24, 0);
        return b.x - a.x;
      });
      await page.mouse.move(cpt.x, cpt.y);
      await page.mouse.down();
      await page.mouse.move(cpt.x + dx, cpt.y, { steps: 5 });
      await page.mouse.up();
      await sleep(80);
      const shaAfter = await page.evaluate(() => window.__ed.stateSha());
      if (shaBefore !== shaAfter) pass("拖控制點後 state sha 改變");
      else fail("拖控制點後 state sha 沒變");

      const changed = await page.evaluate(() => window.__ed.changedStrokes());
      if (changed.length === 1 && changed[0] === rainStroke)
        pass(`只該筆變（changed=[${changed.join(",")}]，期望 [${rainStroke}]）`);
      else fail(`changed=[${changed.join(",")}]，期望只有 [${rainStroke}]`);

      // A/B：按住 \ → 徽章出現；且原狀 sha ≠ 現在 sha
      const baseSha = await page.evaluate(() => window.__ed.baseSha());
      if (baseSha !== shaAfter) pass("A/B：原狀 sha ≠ 現在 sha（有差異）");
      else fail("A/B：原狀與現在 sha 相同（沒有差異）");

      await page.keyboard.down("\\");
      await sleep(60);
      const badge = await page.evaluate(() => window.__ed.abBadge());
      const abSnap = await page.evaluate(() => window.__ed.snap());
      if (badge && abSnap.ab) pass("按住 \\ 顯示 A/B 原狀（徽章可見）");
      else fail(`A/B 徽章：badge=${badge} ab=${abSnap.ab}`);
      await page.keyboard.up("\\");
      await sleep(60);
      const badgeAfter = await page.evaluate(() => window.__ed.abBadge());
      if (!badgeAfter) pass("放開 \\ 徽章消失");
      else fail("放開 \\ 徽章仍在");
    }

    // ---- 5. 存 patch、重載、重播；state 相同 --------------------------------
    // 先做一個確定的編輯（再拖一次雨的控制點），存檔
    {
      const cpt2 = await page.evaluate(
        ([si, pi]) => window.__ed.pointClient(si, pi),
        [rainStroke, 3] as const,
      );
      if (cpt2) {
        const dx = await page.evaluate(() => {
          const a = window.__ed.clientPoint(0, 0);
          const b = window.__ed.clientPoint(16, 0);
          return b.x - a.x;
        });
        await page.mouse.move(cpt2.x, cpt2.y);
        await page.mouse.down();
        await page.mouse.move(cpt2.x + dx, cpt2.y, { steps: 5 });
        await page.mouse.up();
        await sleep(80);
      }
      const shaSaved = await page.evaluate(() => window.__ed.stateSha());
      await page.evaluate(() => window.__ed.save());
      const path = await page.evaluate(() => window.__ed.patchPath());
      pass(`存檔 ${path}`);

      // 硬重載頁面 → 重播
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => window.__ed?.ready === true, undefined, { timeout: 15000 });
      await page.evaluate(() => window.__ed.open("857E"));
      await sleep(120);
      const shaReplayed = await page.evaluate(() => window.__ed.stateSha());
      const snapRe = await page.evaluate(() => window.__ed.snap());
      if (shaReplayed === shaSaved)
        pass(`重載重播 state 相同（sha ${shaSaved.slice(0, 12)}…，patches=${snapRe.patchCount}）`);
      else
        fail(`重播 sha 不符：存 ${shaSaved.slice(0, 12)}… ≠ 重載 ${shaReplayed.slice(0, 12)}…`);

      const list = await page.evaluate(() => window.__ed.listPatches());
      if (list.length >= 1) pass(`store list：${list.join(", ")}`);
      else fail("data/patches/ 是空的");
    }

    // ---- 6. 上游未變 --------------------------------------------------------
    const up = await runBun("scripts/check-upstream.ts");
    if (up.code === 0) pass("check-upstream（sha + mtime 對基線）");
    else {
      fail("check-upstream");
      info(up.out.trim());
    }

    // ---- 7. console error = 0 -----------------------------------------------
    if (consoleErrors.length === 0) pass("console error = 0");
    else {
      fail(`console error ${consoleErrors.length} 條`);
      for (const e of consoleErrors.slice(0, 10)) info(e);
    }
  } finally {
    await browser.close();
    if (server) server.kill();
  }

  console.log(failed === 0 ? "\nACCEPT PASS（§8 七項全綠）" : `\nACCEPT FAIL（${failed}）`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
