// zig-loader native — loads libcryptocore.so (compiled from the unified Zig
// source) via bun:ffi and exposes a typed API. Pointer handles (ctx) are kept
// as BigInt throughout — converting a 64-bit pointer to Number loses precision.
import { dlopen, FFIType } from "bun:ffi";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const libPath = resolve(here, "../../backend/libcryptocore.so");

const lib = dlopen(libPath, {
  zig_derive_key: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  // ctx handle is a pointer but passed as a u64 integer (BigInt) — FFIType.u64
  zig_cbc_encrypt_begin: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
  zig_cbc_encrypt_update: { args: [FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.u64 },
  zig_cbc_encrypt_final: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.u64 },
  zig_cbc_decrypt_begin: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u64 },
  zig_cbc_decrypt_update: { args: [FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.u64 },
  zig_cbc_decrypt_final: { args: [FFIType.u64, FFIType.ptr], returns: FFIType.i64 },
  zig_cbc_encrypt_oneshot: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.u64 },
  zig_cbc_decrypt_oneshot: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.i64 },
  zig_sha256: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  zig_hmac_sha256: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  zig_password_emoji: { args: [FFIType.ptr, FFIType.u64], returns: FFIType.u32 },
});

const e = lib.symbols as any;
const DUMMY = new Uint8Array(1);
function p(u8: Uint8Array): any { return u8.length > 0 ? u8 : DUMMY; }
function n(v: any): number { return typeof v === "bigint" ? Number(v) : v; }

export const ZIG_CONST = {
  BLOCK_LEN: 16, KEY_LEN: 32, IV_LEN: 16, SALT_LEN: 16, PBKDF2_ITERS: 100_000,
} as const;

// ctx handle is a BigInt (64-bit pointer) — must NOT be converted to Number.
export type Ctx = bigint;

export interface ZigCore {
  deriveKey(password: Uint8Array, salt: Uint8Array): Uint8Array;
  cbcEncryptBegin(key: Uint8Array, iv: Uint8Array): Ctx;
  cbcEncryptUpdate(ctx: Ctx, input: Uint8Array): Uint8Array;
  cbcEncryptFinal(ctx: Ctx): Uint8Array;
  cbcDecryptBegin(key: Uint8Array, iv: Uint8Array): Ctx;
  cbcDecryptUpdate(ctx: Ctx, input: Uint8Array): Uint8Array;
  cbcDecryptFinal(ctx: Ctx): Uint8Array;
  cbcEncryptOneshot(key: Uint8Array, iv: Uint8Array, input: Uint8Array): Uint8Array;
  cbcDecryptOneshot(key: Uint8Array, iv: Uint8Array, input: Uint8Array): Uint8Array;
  sha256(input: Uint8Array): Uint8Array;
  hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array;
}

export function getZigCore(): ZigCore {
  return {
    deriveKey(password, salt) {
      const out = new Uint8Array(ZIG_CONST.KEY_LEN);
      const r = e.zig_derive_key(p(password), BigInt(password.length), p(salt), BigInt(salt.length), p(out));
      if (r !== 0) throw new Error("derive_key failed: " + r);
      return out;
    },
    cbcEncryptBegin(key, iv) {
      // begin returns FFIType.ptr -> BigInt; keep as BigInt.
      const ctx = e.zig_cbc_encrypt_begin(p(key), p(iv));
      if (!ctx) throw new Error("encrypt_begin: no ctx slot");
      return BigInt(ctx);
    },
    cbcEncryptUpdate(ctx, input) {
      const out = new Uint8Array(Math.max(16, Math.floor(input.length / 16) * 16));
      const r = e.zig_cbc_encrypt_update(ctx, p(input), BigInt(input.length), p(out));
      return out.subarray(0, n(r));
    },
    cbcEncryptFinal(ctx) {
      const out = new Uint8Array(16);
      const r = e.zig_cbc_encrypt_final(ctx, p(out));
      return out.subarray(0, n(r));
    },
    cbcDecryptBegin(key, iv) {
      const ctx = e.zig_cbc_decrypt_begin(p(key), p(iv));
      if (!ctx) throw new Error("decrypt_begin: no ctx slot");
      return BigInt(ctx);
    },
    cbcDecryptUpdate(ctx, input) {
      const out = new Uint8Array(Math.max(16, Math.floor(input.length / 16) * 16));
      const r = e.zig_cbc_decrypt_update(ctx, p(input), BigInt(input.length), p(out));
      return out.subarray(0, n(r));
    },
    cbcDecryptFinal(ctx) {
      const out = new Uint8Array(16);
      const r = e.zig_cbc_decrypt_final(ctx, p(out));
      const len = n(r);
      if (len < 0) throw new Error("Invalid PKCS7 padding");
      return out.subarray(0, len);
    },
    cbcEncryptOneshot(key, iv, input) {
      const outLen = input.length + (ZIG_CONST.BLOCK_LEN - (input.length % ZIG_CONST.BLOCK_LEN));
      const out = new Uint8Array(outLen);
      const r = e.zig_cbc_encrypt_oneshot(p(key), p(iv), p(input), BigInt(input.length), p(out));
      return out.subarray(0, n(r));
    },
    cbcDecryptOneshot(key, iv, input) {
      const out = new Uint8Array(input.length);
      const r = e.zig_cbc_decrypt_oneshot(p(key), p(iv), p(input), BigInt(input.length), p(out));
      const len = n(r);
      if (len < 0) throw new Error("Invalid PKCS7 padding");
      return out.subarray(0, len);
    },
    sha256(input) {
      const out = new Uint8Array(32);
      e.zig_sha256(p(input), BigInt(input.length), p(out));
      return out;
    },
    hmacSha256(key, msg) {
      const out = new Uint8Array(32);
      e.zig_hmac_sha256(p(key), BigInt(key.length), p(msg), BigInt(msg.length), p(out));
      return out;
    },
    passwordEmoji(derivedKey) {
      return n(e.zig_password_emoji(p(derivedKey), BigInt(derivedKey.length)));
    },
  };
}
