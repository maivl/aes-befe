// crypto-core barrel — unified AES-256-CBC streaming encryption.
// Three interchangeable backends, all implementing ZigCore:
//   1. Zig Wasm (browser) — zig-loader-web.ts
//   2. Zig .so (Bun FFI) — zig-loader-native.ts
//   3. WebCrypto (Vercel serverless) — webcrypto-loader.ts
// All produce identical ENC1/ENT1 formats → 100% cross-platform compatibility.

export * from "./format.js";
export type { ZigCore, Ctx } from "./zig-loader-types.js";
export { getZigCore as getZigCoreWeb } from "./zig-loader-web.js";
export { getZigCore as getZigCoreNative } from "./zig-loader-native.js";
export { getZigCore as getZigCoreWebCrypto } from "./webcrypto-loader.js";

export const CORE_INFO = {
  algorithm: "AES-256-CBC + PKCS7",
  kdf: "PBKDF2-HMAC-SHA256",
  iterations: 100_000,
  fileMagic: "ENC1",
  textMagic: "ENT1",
  version: 1,
  coreLang: "Zig 0.14 / WebCrypto",
  backends: ["Zig Wasm (browser)", "Zig .so (Bun FFI)", "WebCrypto (Vercel serverless)"],
  description:
    "Unified crypto core: ONE Zig source compiled to wasm + native lib, with a WebCrypto fallback for serverless. Same algorithm, same formats, full cross-platform compatibility.",
};
