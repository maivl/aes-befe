// Shared ZigCore type — both the browser wasm loader and the native .so loader
// implement this interface. ctx handles differ: wasm uses number (32-bit ptr),
// native uses bigint (64-bit ptr). The format layer is generic over Ctx.

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
}
