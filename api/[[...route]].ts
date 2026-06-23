// Vercel Edge Function (catch-all) — handles ALL /api/* routes.
// Self-contained: the crypto code is inlined to avoid Vercel's edge bundler
// "unsupported modules" errors from cross-directory imports.
// Produces byte-identical ciphertext to the Zig core (standard AES-256-CBC +
// PKCS7 + PBKDF2-HMAC-SHA256), so files are 100% cross-compatible.

// ============ INLINED CRYPTO CORE ============
const MAGIC_FILE = "ENC1";
const MAGIC_TEXT = "ENT1";
const VERSION = 1;
const FLAG_HAS_THUMB = 0x01;
const SALT_LEN = 16;
const IV_LEN = 16;
const KEY_LEN = 32;
const PBKDF2_ITERS = 100_000;

const EMOJIS = [
  "😀","😃","😄","😁","😆","😅","😂","🤣","😊","😇","🙂","🙃","😉","😌","😍","🥰",
  "😘","😗","😙","😚","😋","😛","😝","😜","🤪","🤨","🧐","🤓","😎","🤩","🥳","😏",
  "😒","😞","😔","😟","😕","🙁","☹️","😣","😖","😫","😩","🥺","😢","😭","😤","😠",
  "😡","🤬","🤯","😳","🥵","🥶","😱","😨","😰","😥","😓","🤗","🤔","🤭","🤫","🤥",
  "😶","😐","😑","😬","🙄","😯","😦","😧","😮","😲","🥱","😴","🤤","😪","😵","🤐",
  "🥴","🤢","🤮","🤧","😷","🤒","🤕","🤑","🤠","😈","👿","👹","👺","🤡","💩","👻",
];

interface FileMeta {
  originalName: string; originalSize: number; mimeType: string; extension: string;
  createdAt: string; encryptedAt: string; note: string;
  thumbnailMime?: string; thumbnailW?: number; thumbnailH?: number; passwordEmoji?: string;
}
interface TextMeta { createdAt: string; note: string; passwordEmoji?: string; }
interface InspectResult { meta: FileMeta; hasThumbnail: boolean; thumbnailBase64?: string; dataOffset: number; }

const utf8Encode = (s: string): Uint8Array => new TextEncoder().encode(s);
const utf8Decode = (b: Uint8Array): string => new TextDecoder().decode(b);
function concat(parts: Uint8Array[]): Uint8Array {
  let t = 0; for (const p of parts) t += p.length;
  const o = new Uint8Array(t); let off = 0;
  for (const p of parts) { o.set(p, off); off += p.length; }
  return o;
}
function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4); b[0]=n&0xff; b[1]=(n>>>8)&0xff; b[2]=(n>>>16)&0xff; b[3]=(n>>>24)&0xff; return b;
}
function readU32le(b: Uint8Array, o: number): number { return (b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0; }
function bytesToBase64(bytes: Uint8Array): string {
  let bin = ""; const C = 0x8000;
  for (let i = 0; i < bytes.length; i += C) bin += String.fromCharCode.apply(null, bytes.subarray(i, i+C) as unknown as number[]);
  return btoa(bin);
}
function randomBytes(n: number): Uint8Array { const o = new Uint8Array(n); crypto.getRandomValues(o); return o; }

async function passwordToEmoji(password: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", password);
  const bytes = new Uint8Array(h); let sum = 0;
  for (const b of bytes) sum += b;
  return EMOJIS[sum % EMOJIS.length];
}

async function deriveKey(password: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const bk = await crypto.subtle.importKey("raw", password, { name: "PBKDF2" }, false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERS, hash: "SHA-256" }, bk, 256);
  return new Uint8Array(bits);
}
function pkcs7Pad(d: Uint8Array): Uint8Array {
  const p = 16 - (d.length % 16); const o = new Uint8Array(d.length + p); o.set(d, 0); o.fill(p, d.length); return o;
}
function pkcs7Unpad(d: Uint8Array): Uint8Array {
  if (!d.length || d.length % 16) throw new Error("Invalid PKCS7 length");
  const p = d[d.length - 1]; if (p < 1 || p > 16) throw new Error("Invalid PKCS7 padding");
  for (let i = d.length - p; i < d.length; i++) if (d[i] !== p) throw new Error("Invalid PKCS7 padding");
  return d.subarray(0, d.length - p);
}
async function aesEnc(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const ck = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["encrypt"]);
  const ct = await crypto.subtle.encrypt({ name: "AES-CBC", iv }, ck, pkcs7Pad(data));
  return new Uint8Array(ct);
}
async function aesDec(key: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const ck = await crypto.subtle.importKey("raw", key, { name: "AES-CBC" }, false, ["decrypt"]);
  const pt = await crypto.subtle.decrypt({ name: "AES-CBC", iv }, ck, data);
  return new Uint8Array(pt);
}

// ByteReader for parsing headers from async streams
class ByteReader {
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
  remaining(): AsyncIterable<Uint8Array> {
    const self = this;
    return { [Symbol.asyncIterator]() {
      let emitted = false;
      return { async next() {
        if (!emitted) { emitted = true; if (self.buf.length > 0) { const b = self.buf; self.buf = new Uint8Array(0); return { value: b, done: false as const }; } }
        const r = await self.iter.next(); if (r.done) return { value: undefined, done: true as const };
        return { value: r.value as Uint8Array, done: false as const };
      }};
    }};
  }
}
function streamToIter<T extends Uint8Array>(s: ReadableStream<T>): AsyncIterable<T> {
  const rd = s.getReader();
  return { [Symbol.asyncIterator]() {
    return { async next() { const r = await rd.read(); if (r.done) return { value: undefined, done: true as const }; return { value: r.value as T, done: false as const }; },
      async return() { try { await rd.cancel(); } catch {} return { value: undefined, done: true as const }; } };
  }};
}
type Src = AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;
function toIter(s: Src): AsyncIterable<Uint8Array> {
  return typeof (s as ReadableStream<Uint8Array>).getReader === "function" ? streamToIter(s as ReadableStream<Uint8Array>) : (s as AsyncIterable<Uint8Array>);
}
async function* bytesGen(b: Uint8Array): AsyncGenerator<Uint8Array> { yield b; }

// ---- ENC1 file ----
async function* encryptFileStream(opts: { meta: FileMeta; thumbnail?: Uint8Array; password: Uint8Array; plaintext: Src }): AsyncGenerator<Uint8Array> {
  const salt = randomBytes(SALT_LEN); const iv = randomBytes(IV_LEN);
  const emoji = await passwordToEmoji(opts.password);
  const meta: FileMeta = { ...opts.meta, encryptedAt: opts.meta.encryptedAt || new Date().toISOString(), passwordEmoji: emoji };
  const hasThumb = !!opts.thumbnail && opts.thumbnail.length > 0;
  const json = utf8Encode(JSON.stringify(meta));
  const prefix = new Uint8Array(8); prefix.set(utf8Encode(MAGIC_FILE), 0); prefix[4] = VERSION; prefix[5] = hasThumb ? FLAG_HAS_THUMB : 0;
  yield prefix; yield u32le(json.length); yield json;
  yield u32le(hasThumb ? (opts.thumbnail as Uint8Array).length : 0);
  if (hasThumb) yield opts.thumbnail as Uint8Array;
  yield salt; yield iv;
  const chunks: Uint8Array[] = []; for await (const c of toIter(opts.plaintext)) { if (c.length) chunks.push(c); }
  yield await aesEnc(await deriveKey(opts.password, salt), iv, concat(chunks));
}
async function* decryptFileStream(opts: { password: Uint8Array; ciphertext: Src }): AsyncGenerator<Uint8Array> {
  const r = new ByteReader(toIter(opts.ciphertext));
  const magic = utf8Decode(await r.read(4)); if (magic !== MAGIC_FILE) throw new Error(`Not ENC1 (got "${magic}")`);
  const ver = (await r.read(1))[0]; if (ver !== VERSION) throw new Error(`Unsupported version ${ver}`);
  await r.read(1); await r.read(2);
  const jl = await r.readU32(); const meta: FileMeta = JSON.parse(utf8Decode(await r.read(jl)));
  const tl = await r.readU32(); const thumb = tl > 0 ? await r.read(tl) : undefined;
  const salt = await r.read(SALT_LEN); const iv = await r.read(IV_LEN);
  const chunks: Uint8Array[] = []; for await (const c of r.remaining()) { if (c.length) chunks.push(c); }
  yield await aesDec(await deriveKey(opts.password, salt), iv, concat(chunks));
  (decryptFileStream as any).__meta = meta; (decryptFileStream as any).__thumb = thumb;
}
async function inspectFileStream(ct: Src): Promise<{ meta: FileMeta; thumbnail?: Uint8Array; dataOffset: number }> {
  const r = new ByteReader(toIter(ct));
  const magic = utf8Decode(await r.read(4)); if (magic !== MAGIC_FILE) throw new Error(`Not ENC1 (got "${magic}")`);
  const ver = (await r.read(1))[0]; if (ver !== VERSION) throw new Error(`Unsupported version ${ver}`);
  await r.read(1); await r.read(2);
  const jl = await r.readU32(); const meta: FileMeta = JSON.parse(utf8Decode(await r.read(jl)));
  const tl = await r.readU32(); const thumbnail = tl > 0 ? await r.read(tl) : undefined;
  await r.read(SALT_LEN); await r.read(IV_LEN);
  return { meta, thumbnail, dataOffset: 8 + 4 + jl + 4 + tl + SALT_LEN + IV_LEN };
}

// ---- ENT1 text ----
async function encryptText(text: string, password: Uint8Array, note = ""): Promise<Uint8Array> {
  const salt = randomBytes(SALT_LEN); const iv = randomBytes(IV_LEN);
  const emoji = await passwordToEmoji(password);
  const meta: TextMeta = { createdAt: new Date().toISOString(), note, passwordEmoji: emoji };
  const json = utf8Encode(JSON.stringify(meta));
  const cipher = await aesEnc(await deriveKey(password, salt), iv, utf8Encode(text));
  const prefix = new Uint8Array(8); prefix.set(utf8Encode(MAGIC_TEXT), 0); prefix[4] = VERSION;
  return concat([prefix, u32le(json.length), json, salt, iv, cipher]);
}
async function decryptText(blob: Uint8Array, password: Uint8Array): Promise<{ text: string; meta: TextMeta }> {
  const magic = utf8Decode(blob.subarray(0, 4)); if (magic !== MAGIC_TEXT) throw new Error(`Not ENT1 (got "${magic}")`);
  let off = 4; const ver = blob[off++]; if (ver !== VERSION) throw new Error(`Unsupported version ${ver}`);
  off++; off += 2; const jl = readU32le(blob, off); off += 4;
  const meta: TextMeta = JSON.parse(utf8Decode(blob.subarray(off, off + jl))); off += jl;
  const salt = blob.subarray(off, off + SALT_LEN); off += SALT_LEN;
  const iv = blob.subarray(off, off + IV_LEN); off += IV_LEN;
  const cipher = blob.subarray(off);
  const pt = await aesDec(await deriveKey(password, salt), iv, cipher);
  return { text: utf8Decode(pt), meta };
}
async function encryptTextToBase64(text: string, password: Uint8Array, note = ""): Promise<string> {
  return bytesToBase64(await encryptText(text, password, note));
}
async function decryptTextFromBase64(b64: string, password: Uint8Array): Promise<{ text: string; meta: TextMeta }> {
  const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return decryptText(out, password);
}

const CORE_INFO = { algorithm: "AES-256-CBC + PKCS7", kdf: "PBKDF2-HMAC-SHA256", iterations: PBKDF2_ITERS, fileMagic: MAGIC_FILE, textMagic: MAGIC_TEXT, version: VERSION, backend: "vercel-edge" };

// ============ ROUTER ============
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const path = url.pathname;

  try {
    // ---- health ----
    if (path === "/api/health") return json({ ok: true, core: CORE_INFO, backend: "vercel-edge" });

    // ---- text encrypt ----
    if (path === "/api/encrypt/text" && req.method === "POST") {
      const { text, password, note } = await req.json();
      if (typeof text !== "string" || typeof password !== "string") return json({ error: "text and password required" }, 400);
      return json({ data: await encryptTextToBase64(text, utf8Encode(password), note || "") });
    }

    // ---- text decrypt ----
    if (path === "/api/decrypt/text" && req.method === "POST") {
      const { data, password } = await req.json();
      if (typeof data !== "string" || typeof password !== "string") return json({ error: "data and password required" }, 400);
      const { text, meta } = await decryptTextFromBase64(data, utf8Encode(password));
      return json({ text, meta });
    }

    // ---- inspect (免密) ----
    if (path === "/api/inspect" && req.method === "POST") {
      const form = await req.formData();
      const file = form.get("file") as File;
      if (!file) return json({ error: "file required" }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { meta, thumbnail, dataOffset } = await inspectFileStream(bytesGen(bytes));
      const hasThumb = !!thumbnail && thumbnail.length > 0;
      return json({ meta, hasThumbnail: hasThumb, thumbnailBase64: hasThumb ? bytesToBase64(thumbnail!) : undefined, dataOffset });
    }

    // ---- file encrypt ----
    if (path === "/api/encrypt/file" && req.method === "POST") {
      const form = await req.formData();
      const file = form.get("file") as File;
      const password = String(form.get("password") || "");
      const meta = JSON.parse(String(form.get("meta") || "{}")) as FileMeta;
      if (!file) return json({ error: "file required" }, 400);
      if (!password) return json({ error: "password required" }, 400);
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      let thumbnail: Uint8Array | undefined;
      const tf = form.get("thumbnail");
      if (tf instanceof File) thumbnail = new Uint8Array(await tf.arrayBuffer());
      const parts: Uint8Array[] = [];
      for await (const c of encryptFileStream({ meta, thumbnail, password: utf8Encode(password), plaintext: bytesGen(fileBytes) })) parts.push(c);
      let total = 0; for (const c of parts) total += c.length;
      const out = new Uint8Array(total); let o = 0; for (const c of parts) { out.set(c, o); o += c.length; }
      const filename = (meta.originalName || "file") + ".enc";
      return new Response(out, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`, "Content-Length": String(total), ...CORS } });
    }

    // ---- file decrypt ----
    if (path === "/api/decrypt/file" && req.method === "POST") {
      const form = await req.formData();
      const file = form.get("file") as File;
      const password = String(form.get("password") || "");
      if (!file) return json({ error: "file required" }, 400);
      if (!password) return json({ error: "password required" }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      let meta: FileMeta;
      try { meta = (await inspectFileStream(bytesGen(bytes))).meta; }
      catch { meta = { originalName: "decrypted.bin", originalSize: 0, mimeType: "application/octet-stream", extension: "bin", createdAt: "", encryptedAt: "", note: "" }; }
      const parts: Uint8Array[] = [];
      for await (const c of decryptFileStream({ password: utf8Encode(password), ciphertext: bytesGen(bytes) })) parts.push(c);
      let total = 0; for (const c of parts) total += c.length;
      const out = new Uint8Array(total); let o = 0; for (const c of parts) { out.set(c, o); o += c.length; }
      const filename = meta.originalName || "decrypted.bin";
      return new Response(out, { headers: { "Content-Type": meta.mimeType || "application/octet-stream", "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`, "Content-Length": String(total), ...CORS } });
    }

    return json({ error: "Not found", path }, 404);
  } catch (e: any) {
    return json({ error: e?.message || String(e) }, 400);
  }
}
