// Shared ZigCore type — GCM interface (no streaming, no padding).

export interface ZigCore {
  deriveKey(password: Uint8Array, salt: Uint8Array): Uint8Array; // 32 bytes
  gcmEncrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Uint8Array; // ciphertext+tag
  gcmDecrypt(key: Uint8Array, nonce: Uint8Array, ciphertextAndTag: Uint8Array): Uint8Array; // plaintext or throw
  sha256(input: Uint8Array): Uint8Array;
  hmacSha256(key: Uint8Array, msg: Uint8Array): Uint8Array;
}
