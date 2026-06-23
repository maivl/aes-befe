// Shared ZigCore type — implemented by the browser wasm loader, the native .so
// loader, AND the WebCrypto fallback (for Vercel serverless). All three produce
// identical ENC1/ENT1 formats so files are cross-compatible across all runtimes.

export type Ctx = number | bigint;

export interface ZigCore {
  deriveKey(password: Uint8Array, salt: Uint8Array): Uint8Array; // 32 bytes
  cbcEncryptBegin(key: Uint8Array, iv: Uint8Array): Ctx;
  cbcEncryptUpdate(ctx: Ctx, input: Uint8Array): Uint8Array;
  cbcEncryptFinal(ctx: Ctx): Uint8Array;
  cbcDecryptBegin(key: Uint8Array, iv: Uint8Array): Ctx;
  cbcDecryptUpdate(ctx: Ctx, input: Uint8Array): Uint8Array;
  cbcDecryptFinal(ctx: Ctx): Uint8Array; // throws on bad padding
  cbcEncryptOneshot(key: Uint8Array, iv: Uint8Array, input: Uint8Array): Uint8Array;
  cbcDecryptOneshot(key: Uint8Array, iv: Uint8Array, input: Uint8Array): Uint8Array;
  sha256(input: Uint8Array): Uint8Array;
  hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array;
  passwordEmoji(derivedKey: Uint8Array): number; // 0..95 index
}
