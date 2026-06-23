// Text string encryption using the unified ENT1 format. Same AES-256-CBC + PBKDF2
// core as file encryption, with a lightweight header (createdAt + note).
import { SALT_LEN, IV_LEN, randomBytes, deriveKey, utf8Encode, utf8Decode, concatBytes } from "./compat.js";
import { cbcEncryptStream, cbcDecryptStream } from "./aes-stream.js";
import { bytesToBase64, base64ToBytes } from "./compat.js";

export const MAGIC_TEXT = "ENT1";
const VERSION = 1;

export interface TextMeta {
  createdAt: string;
  note: string;
}

function u32le(n: number): Uint8Array {
  const b = new Uint8Array(4);
  b[0] = n & 0xff;
  b[1] = (n >>> 8) & 0xff;
  b[2] = (n >>> 16) & 0xff;
  b[3] = (n >>> 24) & 0xff;
  return b;
}

async function collect(gen: AsyncGenerator<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const c of gen) parts.push(c);
  return concatBytes(parts);
}

/** Encrypt a text string. Returns the ENT1 binary blob. */
export async function encryptText(
  text: string,
  password: string,
  note = ""
): Promise<Uint8Array> {
  const meta: TextMeta = { createdAt: new Date().toISOString(), note };
  const json = utf8Encode(JSON.stringify(meta));
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const key = await deriveKey(password, salt);

  const prefix = new Uint8Array(4 + 1 + 1 + 2);
  prefix.set(utf8Encode(MAGIC_TEXT), 0);
  prefix[4] = VERSION;
  prefix[5] = 0;
  prefix[6] = 0;
  prefix[7] = 0;

  const plaintextBytes = utf8Encode(text);
  const cipherGen = cbcEncryptStream(key, iv, (async function* () {
    yield plaintextBytes;
  })());
  const cipher = await collect(cipherGen);

  return concatBytes([prefix, u32le(json.length), json, salt, iv, cipher]);
}

/** Decrypt an ENT1 blob. Returns the text + metadata. */
export async function decryptText(
  blob: Uint8Array,
  password: string
): Promise<{ text: string; meta: TextMeta }> {
  let off = 0;
  const magic = utf8Decode(blob.subarray(0, 4));
  if (magic !== MAGIC_TEXT) throw new Error(`Not an ENT1 text blob (got "${magic}")`);
  off += 4;
  const version = blob[off]; off += 1;
  if (version !== VERSION) throw new Error(`Unsupported version ${version}`);
  off += 1; // flags
  off += 2; // reserved
  const jsonLen =
    (blob[off] | (blob[off + 1] << 8) | (blob[off + 2] << 16) | (blob[off + 3] << 24)) >>> 0;
  off += 4;
  const meta: TextMeta = JSON.parse(utf8Decode(blob.subarray(off, off + jsonLen)));
  off += jsonLen;
  const salt = blob.subarray(off, off + SALT_LEN); off += SALT_LEN;
  const iv = blob.subarray(off, off + IV_LEN); off += IV_LEN;
  const cipher = blob.subarray(off);

  const key = await deriveKey(password, salt);
  const plainGen = cbcDecryptStream(key, iv, (async function* () {
    yield cipher;
  })());
  const plain = await collect(plainGen);
  return { text: utf8Decode(plain), meta };
}

/** Convenience: encrypt text and return a base64 string (for easy copy/paste). */
export async function encryptTextToBase64(text: string, password: string, note = ""): Promise<string> {
  return bytesToBase64(await encryptText(text, password, note));
}

/** Convenience: decrypt a base64 ENT1 string. */
export async function decryptTextFromBase64(b64: string, password: string): Promise<{ text: string; meta: TextMeta }> {
  return decryptText(base64ToBytes(b64), password);
}
