// crypto-core — Unified AES-256-CBC streaming encryption core.
// ONE TypeScript source that runs identically in the browser (WebWorker) and in
// Bun (backend). Provides:
//   - AES-256-CBC + PKCS7 streaming (TB-scale, low memory)
//   - PBKDF2-HMAC-SHA256 key derivation (100000 iterations) via WebCrypto
//   - Unified ENC1 file format with structured metadata + embedded thumbnail
//   - Unified ENT1 text format
//   - Header inspection WITHOUT password (fast listing / preview)
// Cross-platform 100% compatibility is guaranteed because both ends execute the
// exact same code with the exact same formats.

export * from "./compat.js";
export * from "./aes-stream.js";
export * from "./file.js";
export * from "./text.js";

export const CORE_INFO = {
  algorithm: "AES-256-CBC + PKCS7",
  kdf: "PBKDF2-HMAC-SHA256",
  iterations: 100000,
  fileMagic: "ENC1",
  textMagic: "ENT1",
  version: 1,
  description:
    "Unified isomorphic crypto core (browser WebWorker + Bun). Same algorithm, same formats, full cross-compatibility.",
};
