// zig-loader-web.ts — loads crypto.wasm (Zig-compiled AES-256-GCM core).
// GCM is AEAD — no padding, no "Invalid PKCS7" errors. Authentication tag is
// appended to ciphertext automatically by Zig.

export const ZIG_CONST = {
  BLOCK_LEN: 16,
  KEY_LEN: 32,
  NONCE_LEN: 12,
  TAG_LEN: 16,
  SALT_LEN: 16,
  PBKDF2_ITERS: 100_000,
} as const;

let wasm: WebAssembly.Instance | null = null;
let memory: WebAssembly.Memory | null = null;
let exports: any = null;

async function loadWasm(): Promise<void> {
  if (wasm) return;
  const res = await fetch("/crypto.wasm?v=7");
  const bytes = new Uint8Array(await res.arrayBuffer());
  const mod = await WebAssembly.compile(bytes);
  const inst = await WebAssembly.instantiate(mod, {});
  wasm = inst;
  exports = inst.exports;
  memory = exports.memory as WebAssembly.Memory;
  if (typeof (exports as any).zig_gcm_encrypt !== "function") {
    throw new Error("crypto.wasm missing zig_gcm_encrypt — clear cache");
  }
}

function mem(): Uint8Array { return new Uint8Array((memory as WebAssembly.Memory).buffer); }
function resetHeap(): void { if (typeof (exports as any).zig_reset_heap === "function") (exports as any).zig_reset_heap(); }
function alloc(n: number): number {
  const ptr = Number((exports as any).zig_alloc(n));
  if (!ptr) throw new Error("wasm heap exhausted");
  return ptr;
}
function N(v: any): number { return typeof v === "bigint" ? Number(v) : v; }

export interface ZigCore {
  deriveKey(password: Uint8Array, salt: Uint8Array): Uint8Array;
  gcmEncrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Uint8Array; // ciphertext+tag
  gcmDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertextAndTag: Uint8Array): Uint8Array; // plaintext or throw
  sha256(input: Uint8Array): Uint8Array;
  hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array;
}

export async function getZigCore(): Promise<ZigCore> {
  await loadWasm();
  const e = exports as any;
  return {
    deriveKey(password, salt) {
      resetHeap();
      const pp = alloc(password.length);
      const sp = alloc(salt.length);
      const op = alloc(ZIG_CONST.KEY_LEN);
      mem().set(password, pp);
      mem().set(salt, sp);
      const r = e.zig_derive_key(pp, password.length, sp, salt.length, op);
      if (r !== 0) throw new Error("derive_key failed: " + r);
      return mem().slice(op, op + ZIG_CONST.KEY_LEN);
    },
    gcmEncrypt(key, nonce, plaintext) {
      resetHeap();
      const kp = alloc(ZIG_CONST.KEY_LEN);
      const np = alloc(ZIG_CONST.NONCE_LEN);
      const inp = alloc(plaintext.length);
      const outLen = plaintext.length + ZIG_CONST.TAG_LEN;
      const op = alloc(outLen);
      mem().set(key, kp);
      mem().set(nonce, np);
      mem().set(plaintext, inp);
      const n = N(e.zig_gcm_encrypt(kp, np, inp, plaintext.length, op));
      if (n === 0) throw new Error("gcm_encrypt failed");
      return mem().slice(op, op + n);
    },
    gcmDecrypt(key, nonce, ciphertextAndTag) {
      resetHeap();
      const kp = alloc(ZIG_CONST.KEY_LEN);
      const np = alloc(ZIG_CONST.NONCE_LEN);
      const inp = alloc(ciphertextAndTag.length);
      const op = alloc(ciphertextAndTag.length); // max plaintext = ct len
      mem().set(key, kp);
      mem().set(nonce, np);
      mem().set(ciphertextAndTag, inp);
      const n = N(e.zig_gcm_decrypt(kp, np, inp, ciphertextAndTag.length, op));
      if (n < 0) throw new Error("解密失败：密码错误或数据损坏");
      return mem().slice(op, op + n);
    },
    sha256(input) {
      resetHeap();
      const ip = alloc(input.length);
      const op = alloc(32);
      mem().set(input, ip);
      e.zig_sha256(ip, input.length, op);
      return mem().slice(op, op + 32);
    },
    hmacSha256(key, msg) {
      resetHeap();
      const kp = alloc(key.length);
      const mp = alloc(msg.length);
      const op = alloc(32);
      mem().set(key, kp);
      mem().set(msg, mp);
      e.zig_hmac_sha256(kp, key.length, mp, msg.length, op);
      return mem().slice(op, op + 32);
    },
  };
}
