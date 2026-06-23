// format.ts — Shared isomorphic format layer (ENC1 file / ENT1 text).
// Works with THREE backends that all implement ZigCore:
//   1. Zig Wasm (browser WebWorker) — synchronous
//   2. Zig .so (Bun FFI) — synchronous
//   3. WebCrypto (Vercel serverless) — async
// All `core.*` calls are `await`ed so both sync and async backends work.
//
// ENC1 layout:
//   "ENC1" | ver(1) | flags(1) | rsv(2) | headerJsonLen(4 LE) | headerJson
//   | thumbnailLen(4 LE) | thumbnail | salt(16) | iv(16) | ciphertext
//
// ENT1 layout:
//   "ENT1" | ver(1) | flags(1) | rsv(2) | headerJsonLen(4 LE) | headerJson
//   | salt(16) | iv(16) | ciphertext

import type { ZigCore } from "./zig-loader-types.js";

export const MAGIC_FILE = "ENC1";
export const MAGIC_TEXT = "ENT1";
const VERSION = 1;
const FLAG_HAS_THUMB = 0x01;

export const ZIG_CONST = {
  BLOCK_LEN: 16,
  KEY_LEN: 32,
  IV_LEN: 16,
  SALT_LEN: 16,
  PBKDF2_ITERS: 100_000,
} as const;

export interface FileMeta {
  originalName: string;
  originalSize: number;
  mimeType: string;
  extension: string;
  createdAt: string;
  encryptedAt: string;
  note: string;
  thumbnailMime?: string;
  thumbnailW?: number;
  thumbnailH?: number;
  passwordEmoji?: string; // one-way hash of password → emoji (visual fingerprint)
}

export interface TextMeta {
  createdAt: string;
  note: string;
  passwordEmoji?: string;
}

// ---- emoji table (same as user-provided) ----
export const EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰",
  "😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏",
  "😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠",
  "😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥",
  "😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐",
  "🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👹","👺","🤡","💩","👻",
];

export function indexToEmoji(idx: number): string {
  return EMOJIS[idx % EMOJIS.length];
}

// ---- password → emoji (one-way, content-independent) ----
// SHA-256(password) → sum bytes mod 96 → emoji. Only depends on the password,
// NOT on the file content or salt, so the same password always shows the same
// emoji — both in live preview (while typing) and in the encrypted header.
// One-way: 96 buckets means ~1/96 of all passwords share an emoji, so seeing
// it reveals nothing useful about the actual password.
export async function passwordToEmoji(password: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", password as BufferSource);
  const bytes = new Uint8Array(hash);
  let sum = 0;
  for (const b of bytes) sum += b;
  return indexToEmoji(sum % EMOJIS.length);
}

// ---- platform-agnostic helpers ----

export function utf8Encode(s: string): Uint8Array { return new TextEncoder().encode(s); }
export function utf8Decode(b: Uint8Array): string { return new TextDecoder().decode(b); }
export function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0; for (const p of parts) total += p.length;
  const out = new Uint8Array(total); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = n & 0xff; b[1] = (n >>> 8) & 0xff; b[2] = (n >>> 16) & 0xff; b[3] = (n >>> 24) & 0xff;
  return b;
}
function readU32le(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

// ---- ByteReader ----
export class ByteReader {
  private buf = new Uint8Array(0);
  private iter: AsyncIterator<Uint8Array>;
  constructor(src: AsyncIterable<Uint8Array>) { this.iter = src[Symbol.asyncIterator](); }
  private async fill(need: number): Promise<boolean> {
    while (this.buf.length < need) {
      const r = await this.iter.next();
      if (r.done) return false;
      const m = new Uint8Array(this.buf.length + r.value.length);
      m.set(this.buf, 0); m.set(r.value, this.buf.length);
      this.buf = m;
    }
    return true;
  }
  async read(n: number): Promise<Uint8Array> {
    const ok = await this.fill(n);
    if (!ok && this.buf.length < n) throw new Error(`Unexpected EOF (want ${n}, have ${this.buf.length})`);
    const out = this.buf.subarray(0, n); this.buf = this.buf.subarray(n); return out;
  }
  async readU32(): Promise<number> { return readU32le(await this.read(4), 0); }
  remaining(): AsyncIterable<Uint8Array> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        let emitted = false;
        return {
          async next() {
            if (!emitted) {
              emitted = true;
              if (self.buf.length > 0) { const b = self.buf; self.buf = new Uint8Array(0); return { value: b, done: false as const }; }
            }
            const r = await self.iter.next();
            if (r.done) return { value: undefined, done: true as const };
            return { value: r.value as Uint8Array, done: false as const };
          },
        };
      },
    };
  }
}

export function streamToAsyncIterable<T extends Uint8Array>(s: ReadableStream<T>): AsyncIterable<T> {
  const reader = s.getReader();
  return { [Symbol.asyncIterator]() {
    return {
      async next() { const r = await reader.read(); if (r.done) return { value: undefined, done: true as const }; return { value: r.value as T, done: false as const }; },
      async return() { try { await reader.cancel(); } catch {} return { value: undefined, done: true as const }; },
    };
  } };
}

type Source = AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;
function toIter(s: Source): AsyncIterable<Uint8Array> {
  return typeof (s as ReadableStream<Uint8Array>).getReader === "function"
    ? streamToAsyncIterable(s as ReadableStream<Uint8Array>)
    : (s as AsyncIterable<Uint8Array>);
}

// ================= FILE (ENC1) =================

export async function* encryptFileStream(opts: {
  core: ZigCore;
  meta: FileMeta;
  thumbnail?: Uint8Array;
  password: Uint8Array;
  plaintext: Source;
}): AsyncGenerator<Uint8Array> {
  const salt = randomBytes(ZIG_CONST.SALT_LEN);
  const iv = randomBytes(ZIG_CONST.IV_LEN);
  const key = await opts.core.deriveKey(opts.password, salt);
  // Password fingerprint: SHA-256(password) → emoji. Content-independent, so
  // it matches the live preview shown while the user types the password.
  const emoji = await passwordToEmoji(opts.password);
  const meta: FileMeta = {
    ...opts.meta,
    encryptedAt: opts.meta.encryptedAt || new Date().toISOString(),
    passwordEmoji: emoji,
  };
  const hasThumb = !!opts.thumbnail && opts.thumbnail.length > 0;
  const json = utf8Encode(JSON.stringify(meta));

  const prefix = new Uint8Array(8);
  prefix.set(utf8Encode(MAGIC_FILE), 0);
  prefix[4] = VERSION;
  prefix[5] = hasThumb ? FLAG_HAS_THUMB : 0;
  yield prefix;
  yield u32le(json.length); yield json;
  yield u32le(hasThumb ? (opts.thumbnail as Uint8Array).length : 0);
  if (hasThumb) yield opts.thumbnail as Uint8Array;
  yield salt; yield iv;

  const ctx = await opts.core.cbcEncryptBegin(key, iv);
  for await (const chunk of toIter(opts.plaintext)) {
    if (chunk.length === 0) continue;
    const out = await opts.core.cbcEncryptUpdate(ctx, chunk);
    if (out.length) yield out;
  }
  yield await opts.core.cbcEncryptFinal(ctx);
}

export async function* decryptFileStream(opts: {
  core: ZigCore;
  password: Uint8Array;
  ciphertext: Source;
}): AsyncGenerator<Uint8Array> {
  const reader = new ByteReader(toIter(opts.ciphertext));
  const magic = utf8Decode(await reader.read(4));
  if (magic !== MAGIC_FILE) throw new Error(`Not ENC1 (got "${magic}")`);
  const ver = (await reader.read(1))[0];
  if (ver !== VERSION) throw new Error(`Unsupported version ${ver}`);
  await reader.read(1); await reader.read(2);
  const jsonLen = await reader.readU32();
  const meta: FileMeta = JSON.parse(utf8Decode(await reader.read(jsonLen)));
  const thumbLen = await reader.readU32();
  const thumbnail = thumbLen > 0 ? await reader.read(thumbLen) : undefined;
  const salt = await reader.read(ZIG_CONST.SALT_LEN);
  const iv = await reader.read(ZIG_CONST.IV_LEN);
  const key = await opts.core.deriveKey(opts.password, salt);
  const ctx = await opts.core.cbcDecryptBegin(key, iv);
  for await (const chunk of reader.remaining()) {
    if (chunk.length === 0) continue;
    const out = await opts.core.cbcDecryptUpdate(ctx, chunk);
    if (out.length) yield out;
  }
  yield await opts.core.cbcDecryptFinal(ctx);
  (decryptFileStream as any).__meta = meta;
  (decryptFileStream as any).__thumb = thumbnail;
}

export async function inspectFileStream(ciphertext: Source): Promise<{ meta: FileMeta; thumbnail?: Uint8Array; dataOffset: number }> {
  const reader = new ByteReader(toIter(ciphertext));
  const magic = utf8Decode(await reader.read(4));
  if (magic !== MAGIC_FILE) throw new Error(`Not ENC1 (got "${magic}")`);
  const ver = (await reader.read(1))[0];
  if (ver !== VERSION) throw new Error(`Unsupported version ${ver}`);
  await reader.read(1); await reader.read(2);
  const jsonLen = await reader.readU32();
  const meta: FileMeta = JSON.parse(utf8Decode(await reader.read(jsonLen)));
  const thumbLen = await reader.readU32();
  const thumbnail = thumbLen > 0 ? await reader.read(thumbLen) : undefined;
  await reader.read(ZIG_CONST.SALT_LEN); await reader.read(ZIG_CONST.IV_LEN);
  const dataOffset = 8 + 4 + jsonLen + 4 + thumbLen + ZIG_CONST.SALT_LEN + ZIG_CONST.IV_LEN;
  return { meta, thumbnail, dataOffset };
}

// ================= TEXT (ENT1) =================

export async function encryptText(core: ZigCore, text: string, password: Uint8Array, note = ""): Promise<Uint8Array> {
  const salt = randomBytes(ZIG_CONST.SALT_LEN);
  const iv = randomBytes(ZIG_CONST.IV_LEN);
  const key = await core.deriveKey(password, salt);
  const emoji = await passwordToEmoji(password);
  const meta: TextMeta = { createdAt: new Date().toISOString(), note, passwordEmoji: emoji };
  const json = utf8Encode(JSON.stringify(meta));
  const plain = utf8Encode(text);
  const cipher = await core.cbcEncryptOneshot(key, iv, plain);
  const prefix = new Uint8Array(8);
  prefix.set(utf8Encode(MAGIC_TEXT), 0); prefix[4] = VERSION;
  return concat([prefix, u32le(json.length), json, salt, iv, cipher]);
}

export async function decryptText(core: ZigCore, blob: Uint8Array, password: Uint8Array): Promise<{ text: string; meta: TextMeta }> {
  const magic = utf8Decode(blob.subarray(0, 4));
  if (magic !== MAGIC_TEXT) throw new Error(`Not ENT1 (got "${magic}")`);
  let off = 4;
  const ver = blob[off++]; if (ver !== VERSION) throw new Error(`Unsupported version ${ver}`);
  off++; off += 2;
  const jsonLen = readU32le(blob, off); off += 4;
  const meta: TextMeta = JSON.parse(utf8Decode(blob.subarray(off, off + jsonLen))); off += jsonLen;
  const salt = blob.subarray(off, off + ZIG_CONST.SALT_LEN); off += ZIG_CONST.SALT_LEN;
  const iv = blob.subarray(off, off + ZIG_CONST.IV_LEN); off += ZIG_CONST.IV_LEN;
  const cipher = blob.subarray(off);
  const key = await core.deriveKey(password, salt);
  const plain = await core.cbcDecryptOneshot(key, iv, cipher);
  return { text: utf8Decode(plain), meta };
}

export async function encryptTextToBase64(core: ZigCore, text: string, password: Uint8Array, note = ""): Promise<string> {
  return bytesToBase64(await encryptText(core, text, password, note));
}
export async function decryptTextFromBase64(core: ZigCore, b64: string, password: Uint8Array): Promise<{ text: string; meta: TextMeta }> {
  return decryptText(core, base64ToBytes(b64), password);
}
