// zig-loader-native.ts — loads libcryptocore.so (Zig AES-256-GCM) via bun:ffi.
import { dlopen, FFIType } from "bun:ffi";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const libPath = resolve(here, "../../backend/libcryptocore.so");

const lib = dlopen(libPath, {
  zig_derive_key: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  zig_gcm_encrypt: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.u64 },
  zig_gcm_decrypt: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.i64 },
  zig_sha256: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
  zig_hmac_sha256: { args: [FFIType.ptr, FFIType.u64, FFIType.ptr, FFIType.u64, FFIType.ptr], returns: FFIType.i32 },
});

const e = lib.symbols as any;
const DUMMY = new Uint8Array(1);
function p(u8: Uint8Array): any { return u8.length > 0 ? u8 : DUMMY; }
function N(v: any): number { return typeof v === "bigint" ? Number(v) : v; }

export const ZIG_CONST = {
  BLOCK_LEN: 16, KEY_LEN: 32, NONCE_LEN: 12, TAG_LEN: 16, SALT_LEN: 16, PBKDF2_ITERS: 100_000,
} as const;

export interface ZigCore {
  deriveKey(password: Uint8Array, salt: Uint8Array): Uint8Array;
  gcmEncrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Uint8Array;
  gcmDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertextAndTag: Uint8Array): Uint8Array;
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
    gcmEncrypt(key, nonce, plaintext) {
      const outLen = plaintext.length + ZIG_CONST.TAG_LEN;
      const out = new Uint8Array(outLen);
      const n = N(e.zig_gcm_encrypt(p(key), p(nonce), p(plaintext), BigInt(plaintext.length), p(out)));
      return out.subarray(0, n);
    },
    gcmDecrypt(key, nonce, ciphertextAndTag) {
      const out = new Uint8Array(ciphertextAndTag.length);
      const n = N(e.zig_gcm_decrypt(p(key), p(nonce), p(ciphertextAndTag), BigInt(ciphertextAndTag.length), p(out)));
      if (n < 0) throw new Error("解密失败：密码错误或数据损坏");
      return out.subarray(0, n);
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
  };
}
