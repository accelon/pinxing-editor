// Store API client — 資料一律走後端 API（decisions D7：現在是 vite middleware，將來換 Go handler）。
// 允許前綴白名單：data/patches、data/macros、data/dev、out/macros。

const ALLOWED_PREFIXES = ["data/patches/", "data/macros/", "data/dev/", "out/macros/"];

export function isAllowedPath(p: string): boolean {
  const norm = p.replace(/\\/g, "/").replace(/^\/+/, "");
  if (norm.includes("..")) return false;
  return ALLOWED_PREFIXES.some((pre) => norm.startsWith(pre));
}

function req(path: string, init?: RequestInit): Promise<Response> {
  if (!isAllowedPath(path)) return Promise.reject(new Error(`store: 路徑不允許 ${path}`));
  return fetch(`/__store/file?path=${encodeURIComponent(path)}`, init);
}

/** 讀檔；不存在回 null（server 以 200 + x-store-exists: 0 表示，避免 console 404）。 */
export async function storeGet(path: string): Promise<string | null> {
  const res = await req(path);
  if (!res.ok) throw new Error(`store GET ${path} → ${res.status}`);
  if (res.headers.get("x-store-exists") === "0") return null;
  return (await res.text()) as string;
}

/** 寫檔（覆蓋）。 */
export async function storePut(path: string, text: string): Promise<void> {
  const res = await req(path, {
    method: "PUT",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: text,
  });
  if (!res.ok) throw new Error(`store PUT ${path} → ${res.status}: ${await res.text()}`);
}

/** append 一行（JSONL 用）。 */
export async function storeAppend(path: string, line: string): Promise<void> {
  if (!isAllowedPath(path)) throw new Error(`store: 路徑不允許 ${path}`);
  const res = await fetch(`/__store/append`, {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: JSON.stringify({ path, line }),
  });
  if (!res.ok) throw new Error(`store append ${path} → ${res.status}: ${await res.text()}`);
}

/** 列目錄（回相對路徑陣列）。 */
export async function storeList(dir: string): Promise<string[]> {
  const res = await fetch(`/__store/list?dir=${encodeURIComponent(dir)}`);
  if (!res.ok) throw new Error(`store list ${dir} → ${res.status}`);
  return (await res.json()) as string[];
}
