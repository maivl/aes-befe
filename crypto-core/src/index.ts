// crypto-core barrel — unified AES-256-GCM encryption (Zig core).
export * from "./format.js";
export type { ZigCore } from "./zig-loader-types.js";
export { getZigCore } from "./zig-loader-web.js";
export { getZigCore as getZigCoreNative } from "./zig-loader-native.js";

export const CORE_INFO = {
  algorithm: "AES-256-GCM (AEAD)",
  kdf: "PBKDF2-HMAC-SHA256",
  iterations: 100_000,
  fileMagic: "ENC1",
  textMagic: "ENT1",
  version: 2,
  coreLang: "Zig 0.14",
  backends: ["Zig Wasm (browser)", "Zig .so (Bun FFI)"],
  description: "Unified AES-256-GCM crypto core: ONE Zig source → wasm + native lib. AEAD — no padding, authenticated.",
};
