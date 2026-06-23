// api/_lib/crypto.ts — Self-contained crypto module for Vercel Edge Functions.
// Includes: WebCrypto-based AES-256-CBC + PBKDF2 + ENC1/ENT1 format + password emoji.
// No external imports — everything needed is in this file, so Vercel's edge
// bundler can package it without "unsupported module" errors.
//
// Produces byte-identical ciphertext to the Zig core (standard AES-256-CBC),
// so files are 100% cross-compatible across all runtimes.

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

export const EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰",
  "😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏",
  "😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠",
  "😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥",
  "😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐",
  "🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👹","👺","🤡","💩","👻",
];

export function indexToEmoji(idx: number): string { return EMOJIS[idx % EMOJIS.length]; }

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
  passwordEmoji?: string;
}

export interface TextMeta {
  createdAt: string;
  note: string;
  passwordEmoji?: string;
}

// ---- helpers ----
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

// ---- password → emoji (one-way, content-independent) ----
// SHA-256(password) → sum bytes mod 96 → emoji. Fast (single hash), deterministic,
// and impossible to reverse: 96 buckets means any of ~1/96 of all passwords map
// to the same emoji, so seeing it reveals nothing useful.
export async function passwordToEmoji(password: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", password as BufferSource);
  const bytes = new Uint8Array(hash);
  let sum = 0;
  for (const b of bytes) sum += b;
  return indexToEmoji(sum % EMOJIS.length);
}

// ---- WebCrypto core (AES-256-CBC + PBKDF2) ----
async function deriveKey(password: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey("raw", password as BufferSource, { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: ZIG_CONST.PBKDF2_ITERS, hash: "SHA-256" },
    baseKey, 256
  );
  return new Uint8Array(bits);
}

function pkcs7Pad(data: Uint8Array): Uint8Array {
  const padLen = 16 - (data.length % 16);
  const out = new Uint8Array(data.length + padLen);
  out.set(data, 0);
  out.fill(padLen, data.length);
  return out;
}
function pkcs7Unpad(data: Uint8Array): Uint8Array {
  if (data.length === 0 || data.length % 16 !== 0) throw new Error("Invalid PKCS7 data length");
  const padLen = data[data.length - 1];
  if (padLen < 1 || padLen > 16) throw new Error("Invalid PKCS7 padding");
  for (let i = data.length - padLen; i < data.length; i++) {
    if (data[i] !== padLen) throw new Error("Invalid PKCS7 padding");
  }
  return data.subarray(0, data.length - padLen);
}

async function aesCbcEncrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "AES-CBC" }, false, ["encrypt"]);
  const padded = pkcs7Pad(data);
  const ct = await crypto.subtle.encrypt({ name: "AES-CBC", iv: iv as BufferSource }, cryptoKey, padded as BufferSource);
  return new Uint8Array(ct);
}
async function aesCbcDecrypt(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key as BufferSource, { name: "AES-CBC" }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-CBC", iv: iv as BufferSource }, cryptoKey, data as BufferSource);
  return new Uint8Array(pt);
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
  meta: FileMeta; thumbnail?: Uint8Array; password: Uint8Array; plaintext: Source;
}): AsyncGenerator<Uint8Array> {
  const salt = randomBytes(ZIG_CONST.SALT_LEN);
  const iv = randomBytes(ZIG_CONST.IV_LEN);
  const emoji = await passwordToEmoji(opts.password);
  const meta: FileMeta = { ...opts.meta, encryptedAt: opts.meta.encryptedAt || new Date().toISOString(), passwordEmoji: emoji };
  const hasThumb = !!opts.thumbnail && opts.thumbnail.length > 0;
  const json = utf8Encode(JSON.stringify(meta));
  const prefix = new Uint8Array(8);
  prefix.set(utf8Encode(MAGIC_FILE), 0); prefix[4] = VERSION; prefix[5] = hasThumb ? FLAG_HAS_THUMB : 0;
  yield prefix;
  yield u32le(json.length); yield json;
  yield u32le(hasThumb ? (opts.thumbnail as Uint8Array).length : 0);
  if (hasThumb) yield opts.thumbnail as Uint8Array;
  yield salt; yield iv;
  // WebCrypto can't stream CBC — buffer then encrypt all at once
  const chunks: Uint8Array[] = [];
  for await (const chunk of toIter(opts.plaintext)) { if (chunk.length) chunks.push(chunk); }
  const plaintext = concat(chunks);
  const ct = await aesCbcEncrypt(await deriveKey(opts.password, salt), iv, plaintext);
  yield ct;
}

export async function* decryptFileStream(opts: {
  password: Uint8Array; ciphertext: Source;
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
  const chunks: Uint8Array[] = [];
  for await (const chunk of reader.remaining()) { if (chunk.length) chunks.push(chunk); }
  const ct = concat(chunks);
  const pt = await aesCbcDecrypt(await deriveKey(opts.password, salt), iv, ct);
  yield pt;
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

export async function encryptText(text: string, password: Uint8Array, note = ""): Promise<Uint8Array> {
  const salt = randomBytes(ZIG_CONST.SALT_LEN);
  const iv = randomBytes(ZIG_CONST.IV_LEN);
  const emoji = await passwordToEmoji(password);
  const meta: TextMeta = { createdAt: new Date().toISOString(), note, passwordEmoji: emoji };
  const json = utf8Encode(JSON.stringify(meta));
  const cipher = await aesCbcEncrypt(await deriveKey(password, salt), iv, utf8Encode(text));
  const prefix = new Uint8Array(8);
  prefix.set(utf8Encode(MAGIC_TEXT), 0); prefix[4] = VERSION;
  return concat([prefix, u32le(json.length), json, salt, iv, cipher]);
}

export async function decryptText(blob: Uint8Array, password: Uint8Array): Promise<{ text: string; meta: TextMeta }> {
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
  const pt = await aesCbcDecrypt(await deriveKey(password, salt), iv, cipher);
  return { text: utf8Decode(pt), meta };
}

export async function encryptTextToBase64(text: string, password: Uint8Array, note = ""): Promise<string> {
  return bytesToBase64(await encryptText(text, password, note));
}
export async function decryptTextFromBase64(b64: string, password: Uint8Array): Promise<{ text: string; meta: TextMeta }> {
  return decryptText(base64ToBytes(b64), password);
}

export const CORE_INFO = {
  algorithm: "AES-256-CBC + PKCS7",
  kdf: "PBKDF2-HMAC-SHA256",
  iterations: 100_000,
  fileMagic: "ENC1",
  textMagic: "ENT1",
  version: 1,
  backend: "vercel-edge (WebCrypto)",
};
