// zig-loader browser — loads crypto.wasm (compiled from the unified Zig source)
// and exposes a typed JS API. Runs inside the WebWorker. All crypto primitives
// execute in the Zig-compiled Wasm module.
//
// Memory: JS calls zig_alloc(n) to get a pointer inside Zig's own scratch heap
// (past static data). This avoids the "memory access out of bounds" bug where
// a JS-side bump allocator starting at address 0 overwrote Zig's ctx_pool.

export const ZIG_CONST = {
  BLOCK_LEN: 16,
  KEY_LEN: 32,
  IV_LEN: 16,
  SALT_LEN: 16,
  PBKDF2_ITERS: 100_000,
} as const;

let wasm: WebAssembly.Instance | null = null;
let memory: WebAssembly.Memory | null = null;
let exports: any = null;

async function loadWasm(): Promise<void> {
  if (wasm) return;
  const res = await fetch("/crypto.wasm");
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mod = await WebAssembly.compile(bytes);
  const inst = await WebAssembly.instantiate(mod, {});
  wasm = inst;
  exports = inst.exports;
  memory = exports.memory as WebAssembly.Memory;
}

/** Fresh view over current wasm memory. */
function mem(): Uint8Array {
  return new Uint8Array((memory as WebAssembly.Memory).buffer);
}

/** Allocate n bytes inside Zig's scratch heap; returns a pointer (number). */
function alloc(n: number): number {
  const ptr = Number((exports as any).zig_alloc(n));
  return ptr;
}

function toNum(v: any): number {
  return typeof v === "bigint" ? Number(v) : v;
}

export interface ZigCore {
  deriveKey(password: Uint8Array, salt: Uint8Array): Uint8Array;
  cbcEncryptBegin(key: Uint8Array, iv: Uint8Array): number;
  cbcEncryptUpdate(ctx: number, input: Uint8Array): Uint8Array;
  cbcEncryptFinal(ctx: number): Uint8Array;
  cbcDecryptBegin(key: Uint8Array, iv: Uint8Array): number;
  cbcDecryptUpdate(ctx: number, input: Uint8Array): Uint8Array;
  cbcDecryptFinal(ctx: number): Uint8Array;
  cbcEncryptOneshot(key: Uint8Array, iv: Uint8Array, input: Uint8Array): Uint8Array;
  cbcDecryptOneshot(key: Uint8Array, iv: Uint8Array, input: Uint8Array): Uint8Array;
  sha256(input: Uint8Array): Uint8Array;
  hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array;
  passwordEmoji(derivedKey: Uint8Array): number;
}

export async function getZigCore(): Promise<ZigCore> {
  await loadWasm();
  const e = exports as any;
  return {
    deriveKey(password, salt) {
      const pp = alloc(password.length);
      const sp = alloc(salt.length);
      const op = alloc(ZIG_CONST.KEY_LEN);
      mem().set(password, pp);
      mem().set(salt, sp);
      const r = e.zig_derive_key(pp, password.length, sp, salt.length, op);
      if (r !== 0) throw new Error("derive_key failed: " + r);
      return mem().slice(op, op + ZIG_CONST.KEY_LEN);
    },
    cbcEncryptBegin(key, iv) {
      const kp = alloc(key.length);
      const ip = alloc(iv.length);
      mem().set(key, kp);
      mem().set(iv, ip);
      const ctx = toNum(e.zig_cbc_encrypt_begin(kp, ip));
      if (!ctx) throw new Error("encrypt_begin: no ctx slot");
      return ctx;
    },
    cbcEncryptUpdate(ctx, input) {
      const ip = alloc(input.length);
      const op = alloc(Math.max(16, Math.floor(input.length / 16) * 16));
      mem().set(input, ip);
      const n = toNum(e.zig_cbc_encrypt_update(ctx, ip, input.length, op));
      return mem().slice(op, op + n);
    },
    cbcEncryptFinal(ctx) {
      const op = alloc(16);
      const n = toNum(e.zig_cbc_encrypt_final(ctx, op));
      return mem().slice(op, op + n);
    },
    cbcDecryptBegin(key, iv) {
      const kp = alloc(key.length);
      const ip = alloc(iv.length);
      mem().set(key, kp);
      mem().set(iv, ip);
      const ctx = toNum(e.zig_cbc_decrypt_begin(kp, ip));
      if (!ctx) throw new Error("decrypt_begin: no ctx slot");
      return ctx;
    },
    cbcDecryptUpdate(ctx, input) {
      const ip = alloc(input.length);
      const op = alloc(Math.max(16, Math.floor(input.length / 16) * 16));
      mem().set(input, ip);
      const n = toNum(e.zig_cbc_decrypt_update(ctx, ip, input.length, op));
      return mem().slice(op, op + n);
    },
    cbcDecryptFinal(ctx) {
      const op = alloc(16);
      const n = toNum(e.zig_cbc_decrypt_final(ctx, op));
      if (n < 0) throw new Error("Invalid PKCS7 padding");
      return mem().slice(op, op + n);
    },
    cbcEncryptOneshot(key, iv, input) {
      const kp = alloc(key.length);
      const ip2 = alloc(iv.length);
      const inp = alloc(input.length);
      const outLen = input.length + (ZIG_CONST.BLOCK_LEN - (input.length % ZIG_CONST.BLOCK_LEN));
      const op = alloc(outLen);
      mem().set(key, kp);
      mem().set(iv, ip2);
      mem().set(input, inp);
      const n = toNum(e.zig_cbc_encrypt_oneshot(kp, ip2, inp, input.length, op));
      return mem().slice(op, op + n);
    },
    cbcDecryptOneshot(key, iv, input) {
      const kp = alloc(key.length);
      const ip2 = alloc(iv.length);
      const inp = alloc(input.length);
      const op = alloc(input.length);
      mem().set(key, kp);
      mem().set(iv, ip2);
      mem().set(input, inp);
      const n = toNum(e.zig_cbc_decrypt_oneshot(kp, ip2, inp, input.length, op));
      if (n < 0) throw new Error("Invalid PKCS7 padding");
      return mem().slice(op, op + n);
    },
    sha256(input) {
      const ip = alloc(input.length);
      const op = alloc(32);
      mem().set(input, ip);
      e.zig_sha256(ip, input.length, op);
      return mem().slice(op, op + 32);
    },
    hmacSha256(key, msg) {
      const kp = alloc(key.length);
      const mp = alloc(msg.length);
      const op = alloc(32);
      mem().set(key, kp);
      mem().set(msg, mp);
      e.zig_hmac_sha256(kp, key.length, mp, msg.length, op);
      return mem().slice(op, op + 32);
    },
    passwordEmoji(derivedKey) {
      const kp = alloc(derivedKey.length);
      mem().set(derivedKey, kp);
      return toNum(e.zig_password_emoji(kp, derivedKey.length));
    },
  };
}
