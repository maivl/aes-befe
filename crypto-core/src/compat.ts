// Isomorphic compatibility helpers — run identically in browser (WebWorker) and Bun.
// Uses Web Crypto API (native to both environments, hardware-accelerated) for PBKDF2
// and CSPRNG, giving one source code with 100% identical behaviour across platforms.

export const SALT_LEN = 16;
export const IV_LEN = 16;
export const KEY_LEN = 32; // AES-256
export const PBKDF2_ITERS = 100000; // PBKDF2-HMAC-SHA256 iterations
export const BLOCK_LEN = 16; // AES block size

/** Secure random bytes via the platform CSPRNG (WebCrypto). */
export function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  crypto.getRandomValues(out);
  return out;
}

/** UTF-8 encode a string to Uint8Array. */
export function utf8Encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/** UTF-8 decode bytes to string. */
export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

/**
 * Derive a 32-byte AES-256 key from password + salt using PBKDF2-HMAC-SHA256.
 * Uses WebCrypto subtle.deriveBits — available natively in browser & Bun.
 */
export async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    utf8Encode(password) as BufferSource,
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERS,
      hash: "SHA-256",
    },
    baseKey,
    KEY_LEN * 8
  );
  return new Uint8Array(bits);
}

// ---- Base64 helpers (chunked to avoid call-stack limits on large arrays) ----

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[]
    );
  }
  return btoa(bin);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Concatenate a list of Uint8Array chunks into one. */
export function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

/** PKCS7 pad a buffer to a multiple of BLOCK_LEN. Always adds padding. */
export function pkcs7Pad(data: Uint8Array): Uint8Array {
  const padLen = BLOCK_LEN - (data.length % BLOCK_LEN);
  const out = new Uint8Array(data.length + padLen);
  out.set(data, 0);
  out.fill(padLen, data.length);
  return out;
}

/** Remove PKCS7 padding. Throws if padding is invalid. */
export function pkcs7Unpad(data: Uint8Array): Uint8Array {
  if (data.length === 0 || data.length % BLOCK_LEN !== 0) {
    throw new Error("Invalid PKCS7 data length");
  }
  const padLen = data[data.length - 1];
  if (padLen < 1 || padLen > BLOCK_LEN) {
    throw new Error("Invalid PKCS7 padding");
  }
  // verify padding bytes
  for (let i = data.length - padLen; i < data.length; i++) {
    if (data[i] !== padLen) throw new Error("Invalid PKCS7 padding bytes");
  }
  return data.subarray(0, data.length - padLen);
}
