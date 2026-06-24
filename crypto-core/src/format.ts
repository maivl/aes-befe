// format.ts — Shared isomorphic format layer (ENC1 file / ENT1 text).
// Uses AES-256-GCM (AEAD) — no padding, no "Invalid PKCS7" errors.
// Authentication tag is appended to ciphertext by the Zig core.
//
// ENC1 layout (GCM):
//   "ENC1" | ver(2) | flags(1) | rsv(1) | headerJsonLen(4 LE) | headerJson
//   | thumbnailLen(4 LE) | thumbnail | salt(16) | nonce(12) | ciphertext+tag
//
// ENT1 layout (GCM):
//   "ENT1" | ver(2) | flags(1) | rsv(1) | headerJsonLen(4 LE) | headerJson
//   | salt(16) | nonce(12) | ciphertext+tag
//
// Version bumped to 2 for GCM (version 1 was CBC).

import type { ZigCore } from "./zig-loader-types.js";

export const MAGIC_FILE = "ENC1";
export const MAGIC_TEXT = "ENT1";
const VERSION = 2; // GCM
const FLAG_HAS_THUMB = 0x01;

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

// ---- ByteReader ----
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

// ================= FILE (ENC1 v2 GCM) =================
// GCM is oneshot (not streaming) — we buffer the plaintext, then encrypt once.
// For large files the worker feeds chunks; we collect them and encrypt at the end.

export async function* encryptFileStream(opts: {
  core: ZigCore; meta: FileMeta; thumbnail?: Uint8Array; password: Uint8Array; plaintext: Source;
}): AsyncGenerator<Uint8Array> {
  const salt = randomBytes(ZIG_CONST.SALT_LEN);
  const nonce = randomBytes(ZIG_CONST.NONCE_LEN);
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
  yield salt; yield nonce;
  // Buffer plaintext then GCM encrypt (AEAD is oneshot)
  const chunks: Uint8Array[] = [];
  for await (const c of toIter(opts.plaintext)) { if (c.length) chunks.push(c); }
  const plaintext = concat(chunks);
  const ct = await opts.core.gcmEncrypt(key, nonce, plaintext);
  yield ct;
}

export async function* decryptFileStream(opts: {
  core: ZigCore; password: Uint8Array; ciphertext: Source;
}): AsyncGenerator<Uint8Array> {
  // Read entire ciphertext into memory (GCM is oneshot — need full ciphertext+tag to verify)
  const chunks: Uint8Array[] = [];
  for await (const c of toIter(opts.ciphertext)) { if (c.length) chunks.push(c); }
  const allBytes = concat(chunks);
  // Parse header
  if (utf8Decode(allBytes.subarray(0, 4)) !== MAGIC_FILE) throw new Error(`Not ENC1`);
  const ver = allBytes[4];
  if (ver !== VERSION) throw new Error(`Unsupported version ${ver} (expected ${VERSION} GCM)`);
  let off = 8; // skip magic(4) + ver(1) + flags(1)
  const jl = readU32le(allBytes, off); off += 4;
  const meta: FileMeta = JSON.parse(utf8Decode(allBytes.subarray(off, off + jl))); off += jl;
  const tl = readU32le(allBytes, off); off += 4;
  const thumbnail = tl > 0 ? allBytes.subarray(off, off + tl) : undefined; off += tl;
  const salt = allBytes.subarray(off, off + ZIG_CONST.SALT_LEN); off += ZIG_CONST.SALT_LEN;
  const nonce = allBytes.subarray(off, off + ZIG_CONST.NONCE_LEN); off += ZIG_CONST.NONCE_LEN;
  const ct = allBytes.subarray(off);
  const key = await opts.core.deriveKey(opts.password, salt);
  const pt = await opts.core.gcmDecrypt(key, nonce, ct);
  yield pt;
  (decryptFileStream as any).__meta = meta;
  (decryptFileStream as any).__thumb = thumbnail;
}

export async function inspectFileStream(ciphertext: Source): Promise<{ meta: FileMeta; thumbnail?: Uint8Array; dataOffset: number }> {
  const chunks: Uint8Array[] = [];
  for await (const c of toIter(ciphertext)) { if (c.length) chunks.push(c); }
  const b = concat(chunks);
  if (utf8Decode(b.subarray(0, 4)) !== MAGIC_FILE) throw new Error(`Not ENC1`);
  const ver = b[4];
  if (ver !== VERSION) throw new Error(`Unsupported version ${ver}`);
  let off = 8;
  const jl = readU32le(b, off); off += 4;
  const meta: FileMeta = JSON.parse(utf8Decode(b.subarray(off, off + jl))); off += jl;
  const tl = readU32le(b, off); off += 4;
  const thumbnail = tl > 0 ? b.subarray(off, off + tl) : undefined; off += tl;
  off += ZIG_CONST.SALT_LEN + ZIG_CONST.NONCE_LEN;
  return { meta, thumbnail, dataOffset: off };
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
