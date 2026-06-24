// format.ts — Shared isomorphic format layer (ENC1 file / ENT1 text).
// Uses AES-256-GCM (AEAD) — no padding, no "Invalid PKCS7" errors.
//
// Large files are encrypted in CHUNKS (default 4MB each) to avoid exhausting
// the wasm heap. Each chunk gets a unique nonce derived from the base nonce
// + chunk index. The chunk size is stored in the header so decrypt knows how
// to split the ciphertext stream.
//
// ENC1 layout (GCM chunked):
//   "ENC1" | ver(2) | flags(1) | rsv(1) | headerJsonLen(4 LE) | headerJson
//   | thumbnailLen(4 LE) | thumbnail | salt(16) | baseNonce(12)
// | chunkSize(4 LE) | chunk1_ct+tag | chunk2_ct+tag | ...
// (each chunk: ct_len = min(chunkSize, remaining) + TAG_LEN(16))
//
// ENT1 layout (GCM, small — text is always < chunkSize):
//   "ENT1" | ver(2) | flags(1) | rsv(1) | headerJsonLen(4 LE) | headerJson
//   | salt(16) | nonce(12) | ciphertext+tag

import type { ZigCore } from "./zig-loader-types.js";

export const MAGIC_FILE = "ENC1";
export const MAGIC_TEXT = "ENT1";
const VERSION = 2;
const FLAG_HAS_THUMB = 0x01;
// Chunk size for file encryption — small enough to fit in wasm heap (64MB)
// with room for input+output buffers. 4MB → 8MB per chunk operation.
export const FILE_CHUNK_SIZE = 4 * 1024 * 1024;

export const ZIG_CONST = {
  BLOCK_LEN: 16,
  KEY_LEN: 32,
  NONCE_LEN: 12,
  TAG_LEN: 16,
  SALT_LEN: 16,
  PBKDF2_ITERS: 100_000,
} as const;

export interface FileMeta {
  originalName: string; originalSize: number; mimeType: string; extension: string;
  createdAt: string; encryptedAt: string; note: string;
  thumbnailMime?: string; thumbnailW?: number; thumbnailH?: number; passwordEmoji?: string;
}
export interface TextMeta { createdAt: string; note: string; passwordEmoji?: string; }

export const EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰",
  "😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏",
  "😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠",
  "😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥",
  "😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐",
  "🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👹","👺","🤡","💩","👻",
];

export function indexToEmoji(idx: number): string { return EMOJIS[idx % EMOJIS.length]; }

export async function passwordToEmoji(password: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", password as BufferSource);
  const bytes = new Uint8Array(hash); let sum = 0;
  for (const b of bytes) sum += b;
  return indexToEmoji(sum % EMOJIS.length);
}

// ---- helpers ----
export function utf8Encode(s: string): Uint8Array { return new TextEncoder().encode(s); }
export function utf8Decode(b: Uint8Array): string { return new TextDecoder().decode(b); }
export function concat(parts: Uint8Array[]): Uint8Array {
  let t = 0; for (const p of parts) t += p.length;
  const o = new Uint8Array(t); let off = 0;
  for (const p of parts) { o.set(p, off); off += p.length; }
  return o;
}
function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4); b[0]=n&0xff; b[1]=(n>>>8)&0xff; b[2]=(n>>>16)&0xff; b[3]=(n>>>24)&0xff; return b;
}
function readU32le(b: Uint8Array, o: number): number { return (b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0; }
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = ""; const C = 0x8000;
  for (let i = 0; i < bytes.length; i += C) bin += String.fromCharCode.apply(null, bytes.subarray(i, i+C) as unknown as number[]);
  return btoa(bin);
}
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function randomBytes(n: number): Uint8Array { const o = new Uint8Array(n); crypto.getRandomValues(o); return o; }

/** Derive a per-chunk nonce from base nonce + chunk index (counter mode). */
function chunkNonce(base: Uint8Array, index: number): Uint8Array {
  const n = new Uint8Array(ZIG_CONST.NONCE_LEN);
  n.set(base);
  // XOR the last 4 bytes with the chunk index (supports up to 2^32 chunks)
  n[8] ^= (index >>> 0) & 0xff;
  n[9] ^= (index >>> 8) & 0xff;
  n[10] ^= (index >>> 16) & 0xff;
  n[11] ^= (index >>> 24) & 0xff;
  return n;
}

// ---- ByteReader (for inspect — reads only the header) ----
export class ByteReader {
  private buf = new Uint8Array(0);
  private iter: AsyncIterator<Uint8Array>;
  constructor(src: AsyncIterable<Uint8Array>) { this.iter = src[Symbol.asyncIterator](); }
  private async fill(need: number): Promise<boolean> {
    while (this.buf.length < need) {
      const r = await this.iter.next(); if (r.done) return false;
      const m = new Uint8Array(this.buf.length + r.value.length); m.set(this.buf, 0); m.set(r.value, this.buf.length); this.buf = m;
    }
    return true;
  }
  async read(n: number): Promise<Uint8Array> {
    const ok = await this.fill(n);
    if (!ok && this.buf.length < n) throw new Error(`Unexpected EOF (want ${n}, have ${this.buf.length})`);
    const o = this.buf.subarray(0, n); this.buf = this.buf.subarray(n); return o;
  }
  async readU32(): Promise<number> { return readU32le(await this.read(4), 0); }
  remaining(): Uint8Array { return this.buf; }
}

export function streamToAsyncIterable<T extends Uint8Array>(s: ReadableStream<T>): AsyncIterable<T> {
  const reader = s.getReader();
  return { [Symbol.asyncIterator]() {
    return { async next() { const r = await reader.read(); if (r.done) return { value: undefined, done: true as const }; return { value: r.value as T, done: false as const }; },
      async return() { try { await reader.cancel(); } catch {} return { value: undefined, done: true as const }; } };
  }};
}

type Source = AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;
function toIter(s: Source): AsyncIterable<Uint8Array> {
  return typeof (s as ReadableStream<Uint8Array>).getReader === "function" ? streamToAsyncIterable(s as ReadableStream<Uint8Array>) : (s as AsyncIterable<Uint8Array>);
}

// ================= FILE (ENC1 v2 GCM chunked) =================

export async function* encryptFileStream(opts: {
  core: ZigCore; meta: FileMeta; thumbnail?: Uint8Array; password: Uint8Array; plaintext: Source;
  chunkSize?: number; onProgress?: (done: number, total: number) => void;
}): AsyncGenerator<Uint8Array> {
  const chunkSize = opts.chunkSize || FILE_CHUNK_SIZE;
  const salt = randomBytes(ZIG_CONST.SALT_LEN);
  const baseNonce = randomBytes(ZIG_CONST.NONCE_LEN);
  const key = await opts.core.deriveKey(opts.password, salt);
  const emoji = await passwordToEmoji(opts.password);
  const meta: FileMeta = { ...opts.meta, encryptedAt: opts.meta.encryptedAt || new Date().toISOString(), passwordEmoji: emoji };
  const hasThumb = !!opts.thumbnail && opts.thumbnail.length > 0;
  const json = utf8Encode(JSON.stringify(meta));
  const prefix = new Uint8Array(8);
  prefix.set(utf8Encode(MAGIC_FILE), 0); prefix[4] = VERSION; prefix[5] = hasThumb ? FLAG_HAS_THUMB : 0;
  yield prefix; yield u32le(json.length); yield json;
  yield u32le(hasThumb ? (opts.thumbnail as Uint8Array).length : 0);
  if (hasThumb) yield opts.thumbnail as Uint8Array;
  yield salt; yield baseNonce;
  yield u32le(chunkSize); // store chunk size so decrypt knows how to split

  // Encrypt chunk by chunk — each chunk gets a unique nonce
  let buf = new Uint8Array(0);
  let chunkIndex = 0;
  let totalDone = 0;
  for await (const c of toIter(opts.plaintext)) {
    if (!c.length) continue;
    // merge into buf
    const merged = new Uint8Array(buf.length + c.length);
    merged.set(buf, 0); merged.set(c, buf.length); buf = merged;
    // encrypt full chunks
    while (buf.length >= chunkSize) {
      const chunk = buf.subarray(0, chunkSize);
      const nonce = chunkNonce(baseNonce, chunkIndex);
      const ct = await opts.core.gcmEncrypt(key, nonce, chunk);
      yield ct;
      chunkIndex++;
      totalDone += chunkSize;
      opts.onProgress?.(totalDone, meta.originalSize);
      buf = buf.subarray(chunkSize);
    }
  }
  // encrypt remaining (last chunk, may be < chunkSize)
  if (buf.length > 0) {
    const nonce = chunkNonce(baseNonce, chunkIndex);
    const ct = await opts.core.gcmEncrypt(key, nonce, buf);
    yield ct;
    totalDone += buf.length;
    opts.onProgress?.(totalDone, meta.originalSize);
  }
}

export async function* decryptFileStream(opts: {
  core: ZigCore; password: Uint8Array; ciphertext: Source;
  onProgress?: (done: number, total: number) => void;
}): AsyncGenerator<Uint8Array> {
  // Read all bytes (needed for chunk splitting)
  const chunks: Uint8Array[] = [];
  for await (const c of toIter(opts.ciphertext)) { if (c.length) chunks.push(c); }
  const b = concat(chunks);
  if (utf8Decode(b.subarray(0, 4)) !== MAGIC_FILE) throw new Error(`Not ENC1`);
  const ver = b[4];
  if (ver !== VERSION) throw new Error(`Unsupported version ${ver} (expected ${VERSION} GCM)`);
  let off = 8;
  const jl = readU32le(b, off); off += 4;
  const meta: FileMeta = JSON.parse(utf8Decode(b.subarray(off, off + jl))); off += jl;
  const tl = readU32le(b, off); off += 4;
  const thumbnail = tl > 0 ? b.subarray(off, off + tl) : undefined; off += tl;
  const salt = b.subarray(off, off + ZIG_CONST.SALT_LEN); off += ZIG_CONST.SALT_LEN;
  const baseNonce = b.subarray(off, off + ZIG_CONST.NONCE_LEN); off += ZIG_CONST.NONCE_LEN;
  const chunkSize = readU32le(b, off); off += 4;
  const key = await opts.core.deriveKey(opts.password, salt);

  // Decrypt chunk by chunk
  let remaining = meta.originalSize;
  let chunkIndex = 0;
  let totalDone = 0;
  let ctOff = off;
  while (remaining > 0) {
    const ptLen = Math.min(chunkSize, remaining);
    const ctLen = ptLen + ZIG_CONST.TAG_LEN;
    if (ctOff + ctLen > b.length) throw new Error(`Unexpected EOF in ciphertext (chunk ${chunkIndex})`);
    const ct = b.subarray(ctOff, ctOff + ctLen);
    const nonce = chunkNonce(baseNonce, chunkIndex);
    const pt = await opts.core.gcmDecrypt(key, nonce, ct);
    yield pt;
    ctOff += ctLen;
    remaining -= ptLen;
    chunkIndex++;
    totalDone += ptLen;
    opts.onProgress?.(totalDone, meta.originalSize);
  }
  (decryptFileStream as any).__meta = meta;
  (decryptFileStream as any).__thumb = thumbnail;
}

export async function inspectFileStream(ciphertext: Source): Promise<{ meta: FileMeta; thumbnail?: Uint8Array; dataOffset: number }> {
  const reader = new ByteReader(toIter(ciphertext));
  if (utf8Decode(await reader.read(4)) !== MAGIC_FILE) throw new Error(`Not ENC1`);
  const ver = (await reader.read(1))[0];
  if (ver !== VERSION) throw new Error(`Unsupported version ${ver}`);
  await reader.read(1); await reader.read(2);
  const jl = await reader.readU32();
  const meta: FileMeta = JSON.parse(utf8Decode(await reader.read(jl)));
  const tl = await reader.readU32();
  const thumbnail = tl > 0 ? await reader.read(tl) : undefined;
  await reader.read(ZIG_CONST.SALT_LEN); // salt
  await reader.read(ZIG_CONST.NONCE_LEN); // baseNonce
  await reader.readU32(); // chunkSize
  const dataOffset = 8 + 4 + jl + 4 + tl + ZIG_CONST.SALT_LEN + ZIG_CONST.NONCE_LEN + 4;
  return { meta, thumbnail, dataOffset };
}

// ================= TEXT (ENT1 v2 GCM) =================

export async function encryptText(core: ZigCore, text: string, password: Uint8Array, note = ""): Promise<Uint8Array> {
  const salt = randomBytes(ZIG_CONST.SALT_LEN);
  const nonce = randomBytes(ZIG_CONST.NONCE_LEN);
  const key = await core.deriveKey(password, salt);
  const emoji = await passwordToEmoji(password);
  const meta: TextMeta = { createdAt: new Date().toISOString(), note, passwordEmoji: emoji };
  const json = utf8Encode(JSON.stringify(meta));
  const cipher = await core.gcmEncrypt(key, nonce, utf8Encode(text));
  const prefix = new Uint8Array(8);
  prefix.set(utf8Encode(MAGIC_TEXT), 0); prefix[4] = VERSION;
  return concat([prefix, u32le(json.length), json, salt, nonce, cipher]);
}

export async function decryptText(core: ZigCore, blob: Uint8Array, password: Uint8Array): Promise<{ text: string; meta: TextMeta }> {
  if (utf8Decode(blob.subarray(0, 4)) !== MAGIC_TEXT) throw new Error(`Not ENT1`);
  const ver = blob[4]; if (ver !== VERSION) throw new Error(`Unsupported version ${ver}`);
  let off = 8;
  const jl = readU32le(blob, off); off += 4;
  const meta: TextMeta = JSON.parse(utf8Decode(blob.subarray(off, off + jl))); off += jl;
  const salt = blob.subarray(off, off + ZIG_CONST.SALT_LEN); off += ZIG_CONST.SALT_LEN;
  const nonce = blob.subarray(off, off + ZIG_CONST.NONCE_LEN); off += ZIG_CONST.NONCE_LEN;
  const cipher = blob.subarray(off);
  const key = await core.deriveKey(password, salt);
  const pt = await core.gcmDecrypt(key, nonce, cipher);
  return { text: utf8Decode(pt), meta };
}

export async function encryptTextToBase64(core: ZigCore, text: string, password: Uint8Array, note = ""): Promise<string> {
  return bytesToBase64(await encryptText(core, text, password, note));
}
export async function decryptTextFromBase64(core: ZigCore, b64: string, password: Uint8Array): Promise<{ text: string; meta: TextMeta }> {
  return decryptText(core, base64ToBytes(b64), password);
}
