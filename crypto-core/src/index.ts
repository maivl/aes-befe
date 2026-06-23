// crypto-core barrel — unified AES-256-CBC streaming encryption built on a
// SINGLE Zig source compiled to wasm (browser) + shared lib (Bun). The format
// layer is isomorphic TS; the crypto primitives are Zig-compiled.

export * from "./format.js";
export type { ZigCore } from "./zig-loader-types.js";

export const CORE_INFO = {
  algorithm: "AES-256-CBC + PKCS7 (Zig)",
  kdf: "PBKDF2-HMAC-SHA256 (Zig)",
  iterations: 100_000,
  fileMagic: "ENC1",
  textMagic: "ENT1",
  version: 1,
  coreLang: "Zig 0.14",
  artifacts: ["crypto.wasm (browser WebWorker)", "libcryptocore.so (Bun FFI)"],
  description:
    "Unified crypto core: ONE Zig source compiled to wasm + native lib. Same algorithm, same formats, full cross-platform compatibility.",
};
