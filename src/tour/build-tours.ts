/**
 * CLI for the self-explaining tour compiler.
 *
 *   bun run build-tours.ts [--config tour.config.ts] [--check]
 *
 * `tour.config.ts` must default-export a `TourCompilerConfig`:
 *
 *   import { defineTourConfig } from './compiler';
 *   export default defineTourConfig({ ... });
 *
 * Paths in the config are resolved from the current working directory.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileTours, writeCompiled, type TourCompilerConfig } from './compiler';

const args = process.argv.slice(2);
const opt = (name: string, fallback: string): string => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const CHECK = args.includes('--check');
const configPath = resolve(opt('config', 'tour.config.ts'));

if (!existsSync(configPath)) {
  console.error(`找不到 config：${configPath}`);
  console.error('建立 tour.config.ts，或加 --config <path>。');
  process.exit(2);
}

const mod = await import(pathToFileURL(configPath).href);
const config = (mod.default ?? mod.config) as TourCompilerConfig | undefined;
if (!config || typeof config !== 'object') {
  console.error(`${configPath} 沒有 default export（或 named export config）`);
  process.exit(2);
}

const result = compileTours(config);
if (result.errors.length) {
  for (const m of result.errors) console.error('  ' + m);
  console.error(`\n${result.errors.length} 個問題，沒有產生資料`);
  process.exit(1);
}

const outFile = resolve(config.outFile);
if (CHECK) {
  const old = existsSync(outFile) ? readFileSync(outFile, 'utf8') : '';
  if (old !== result.text) {
    console.error(`${outFile} 已過期：跑一次 build-tours.ts`);
    process.exit(1);
  }
  console.log(`tour-data 與 ${result.tours.length} 份劇本同步`);
  process.exit(0);
}

writeCompiled(result, outFile);
const kb = (result.text.length / 1024).toFixed(1);
console.log(`wrote ${outFile}  (${kb} KiB)`);
for (const t of result.index) {
  console.log(`  ${t.id}: ${t.title} — ${t.scenes} 場景 / ${t.steps} 步 / ${t.bytes} bytes`);
}
