/**
 * stable 唯讀入口（client 側 gate）：
 * 1. 讀 /__stable/manifest（dev bridge 只轉發母區 stable-manifest.json）。
 * 2. 只准用 manifest 列出的 role 取檔。
 * 3. 取回後比對 bytes + sha256；不符 →「穩定版已變更，請更新 manifest」。
 */

export type StableEntry = { path: string; bytes: number; sha256: string; role: string };
export type Manifest = { format: string; version: string; files: StableEntry[] };

let manifestCache: Manifest | null = null;
const buffers = new Map<string, ArrayBuffer>(); // key = entry.path

export async function loadManifest(): Promise<Manifest> {
  if (manifestCache) return manifestCache;
  const res = await fetch("/__stable/manifest");
  if (!res.ok) throw new Error(`manifest 讀取失敗：HTTP ${res.status}`);
  const m = (await res.json()) as Manifest;
  if (m.format !== "pinxing.stable/1") throw new Error(`未知 manifest format：${m.format}`);
  manifestCache = m;
  return m;
}

export async function loadStable(role: string): Promise<ArrayBuffer> {
  const m = await loadManifest();
  const entry = m.files.find((f) => f.role === role);
  if (!entry) throw new Error(`role「${role}」不在 stable manifest`);
  const cached = buffers.get(entry.path);
  if (cached) return cached;

  const res = await fetch(`/__stable/file/${encodeURIComponent(role)}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `穩定檔載入失敗：HTTP ${res.status}`);
  }
  const buf = await res.arrayBuffer();
  if (buf.byteLength !== entry.bytes) {
    throw new Error("穩定版已變更，請更新 manifest（bytes 不符）");
  }
  const sha = await sha256Hex(buf);
  if (sha !== entry.sha256) {
    throw new Error("穩定版已變更，請更新 manifest（sha256 不符）");
  }
  buffers.set(entry.path, buf);
  return buf;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
