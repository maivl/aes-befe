// File encryption with a custom structured header carrying full original-file
// metadata + an optional embedded thumbnail. Designed so the header can be read
// WITHOUT the password (and without loading the whole file) for fast listing /
// preview of encrypted assets.
import {
  SALT_LEN,
  IV_LEN,
  randomBytes,
  deriveKey,
  utf8Encode,
  utf8Decode,
} from "./compat.js";
import { cbcEncryptStream, cbcDecryptStream, ByteReader, streamToAsyncIterable } from "./aes-stream.js";

export const MAGIC_FILE = "ENC1";
const VERSION = 1;
const FLAG_HAS_THUMBNAIL = 0x01;

export interface FileMeta {
  originalName: string;
  originalSize: number;
  mimeType: string;
  extension: string;
  createdAt: string; // ISO of original file
  encryptedAt: string; // ISO of encryption moment
  note: string;
  thumbnailMime?: string;
  thumbnailW?: number;
  thumbnailH?: number;
}

type Source = AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>;

function toAsyncIterable(src: Source): AsyncIterable<Uint8Array> {
  if (typeof (src as ReadableStream<Uint8Array>).getReader === "function") {
    return streamToAsyncIterable(src as ReadableStream<Uint8Array>);
  }
  return src as AsyncIterable<Uint8Array>;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = (n >>> 16) & 0xff;
  b[3] = (n >>> 24) & 0xff;
  return b;
}

/**
 * Streaming file encryption. Yields the complete encrypted file as Uint8Array
 * chunks (header first, then ciphertext). Memory stays ~ one chunk regardless of
 * total size.
 */
export async function* encryptFileStream(opts: {
  meta: FileMeta;
  thumbnail?: Uint8Array;
  password: string;
  plaintext: Source;
}): AsyncGenerator<Uint8Array> {
  const meta: FileMeta = {
    ...opts.meta,
    encryptedAt: opts.meta.encryptedAt || new Date().toISOString(),
  };
  const hasThumb = !!opts.thumbnail && opts.thumbnail.length > 0;
  const json = utf8Encode(JSON.stringify(meta));
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);

  // Fixed prefix
  const prefix = new Uint8Array(4 + 1 + 1 + 2);
  prefix.set(utf8Encode(MAGIC_FILE), 0); // "ENC1"
  prefix[4] = VERSION;
  prefix[5] = hasThumb ? FLAG_HAS_THUMBNAIL : 0;
  prefix[6] = 0;
  prefix[7] = 0;
  yield prefix;

  // header JSON length + JSON
  yield u32le(json.length);
  yield json;

  // thumbnail length + thumbnail
  yield u32le(hasThumb ? (opts.thumbnail as Uint8Array).length : 0);
  if (hasThumb) yield opts.thumbnail as Uint8Array;

  // salt + iv
  yield salt;
  yield iv;

  // ciphertext stream
  const key = await deriveKey(opts.password, salt);
  yield* cbcEncryptStream(key, iv, toAsyncIterable(opts.plaintext));
}

/**
 * Streaming file decryption. Yields plaintext chunks. Throws on bad password
 * (PKCS7 validation) or corrupt header.
 */
export async function* decryptFileStream(opts: {
  password: string;
  ciphertext: Source;
}): AsyncGenerator<Uint8Array> {
  const reader = new ByteReader(toAsyncIterable(opts.ciphertext));

  const magic = utf8Decode(await reader.read(4));
  if (magic !== MAGIC_FILE) {
    throw new Error(`Not an ENC1 encrypted file (got magic "${magic}")`);
  }
  const version = (await reader.read(1))[0];
  if (version !== VERSION) throw new Error(`Unsupported version ${version}`);
  const flags = (await reader.read(1))[0];
  await reader.read(2); // reserved

  const jsonLen = await reader.readU32();
  const meta: FileMeta = JSON.parse(utf8Decode(await reader.read(jsonLen)));

  const thumbLen = await reader.readU32();
  const thumbnail = thumbLen > 0 ? await reader.read(thumbLen) : undefined;

  const salt = await reader.read(SALT_LEN);
  const iv = await reader.read(IV_LEN);

  const key = await deriveKey(opts.password, salt);
  yield* cbcDecryptStream(key, iv, reader.remaining());

  // attach meta/thumbnail via closure for callers that want them
  (decryptFileStream as any).__lastMeta = meta;
  (decryptFileStream as any).__lastThumbnail = thumbnail;
}

/**
 * Inspect an encrypted file's header WITHOUT a password and WITHOUT reading the
 * whole file. Returns the metadata + embedded thumbnail (if any).
 */
export async function inspectFileStream(ciphertext: Source): Promise<{
  meta: FileMeta;
  thumbnail?: Uint8Array;
  dataOffset: number; // byte offset where ciphertext body begins
}> {
  const reader = new ByteReader(toAsyncIterable(ciphertext));
  const magic = utf8Decode(await reader.read(4));
  if (magic !== MAGIC_FILE) {
    throw new Error(`Not an ENC1 encrypted file (got magic "${magic}")`);
  }
  const version = (await reader.read(1))[0];
  if (version !== VERSION) throw new Error(`Unsupported version ${version}`);
  const flags = (await reader.read(1))[0];
  const reserved = await reader.read(2);
  const jsonLen = await reader.readU32();
  const meta: FileMeta = JSON.parse(utf8Decode(await reader.read(jsonLen)));
  const thumbLen = await reader.readU32();
  const thumbnail = thumbLen > 0 ? await reader.read(thumbLen) : undefined;
  // read salt + iv to compute dataOffset, then we can stop
  const salt = await reader.read(SALT_LEN);
  const iv = await reader.read(IV_LEN);
  const dataOffset = 4 + 1 + 1 + 2 + 4 + jsonLen + 4 + thumbLen + SALT_LEN + IV_LEN;
  return { meta, thumbnail, dataOffset };
}
