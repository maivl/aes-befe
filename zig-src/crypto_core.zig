// crypto_core.zig — Unified AES-256-GCM encryption core in Zig 0.14.
//
// GCM (Galois/Counter Mode) is an AEAD cipher — no padding needed, built-in
// authentication tag. This eliminates the "Invalid PKCS7 padding" errors that
// plagued the CBC implementation.
//
// ONE source compiled to two artifacts:
//   * crypto.wasm            (wasm32-freestanding)  — browser WebWorker
//   * libcryptocore.so       (native)               — Bun backend via bun:ffi
//
// Zig 0.14 API:
//   * AES-256-GCM:  std.crypto.aead.aes_gcm.Aes256Gcm
//   * PBKDF2:       std.crypto.pwhash.pbkdf2
//   * HMAC-SHA256:  std.crypto.auth.hmac.sha2.HmacSha256

const std = @import("std");
const crypto = std.crypto;
const Aes256Gcm = crypto.aead.aes_gcm.Aes256Gcm;
const HmacSha256 = crypto.auth.hmac.sha2.HmacSha256;
const Sha256 = crypto.hash.sha2.Sha256;
const pbkdf2 = crypto.pwhash.pbkdf2;

pub const BLOCK_LEN: usize = 16;
pub const KEY_LEN: usize = 32;
pub const NONCE_LEN: usize = 12; // GCM standard nonce
pub const TAG_LEN: usize = 16;   // GCM authentication tag
pub const SALT_LEN: usize = 16;
pub const PBKDF2_ITERS: u32 = 100_000;

pub const OK: i32 = 0;
pub const ERR_BAD_LEN: i32 = -1;
pub const ERR_BAD_TAG: i32 = -2; // authentication failure (wrong password/corrupted)
pub const ERR_BAD_STATE: i32 = -3;

// ---- JS scratch heap ----
const JS_HEAP_SIZE: usize = 64 * 1024 * 1024; // 64MB
var js_heap: [JS_HEAP_SIZE]u8 = undefined;
var js_heap_off: usize = 0;

export fn zig_reset_heap() void {
    js_heap_off = 0;
}

export fn zig_alloc(n: usize) usize {
    const aligned = (js_heap_off + 15) & ~@as(usize, 15);
    if (n == 0 or aligned + n > JS_HEAP_SIZE) return 0;
    js_heap_off = aligned + n;
    return @intFromPtr(&js_heap[aligned]);
}

// ============ PBKDF2 ============

export fn zig_derive_key(password_ptr: [*]const u8, password_len: usize, salt_ptr: [*]const u8, salt_len: usize, out_key: [*]u8) i32 {
    if (password_len == 0 or salt_len == 0) return ERR_BAD_LEN;
    var key: [KEY_LEN]u8 = undefined;
    pbkdf2(&key, password_ptr[0..password_len], salt_ptr[0..salt_len], PBKDF2_ITERS, HmacSha256) catch return ERR_BAD_STATE;
    @memcpy(out_key[0..KEY_LEN], &key);
    return OK;
}

export fn zig_hmac_sha256(key_ptr: [*]const u8, key_len: usize, msg_ptr: [*]const u8, msg_len: usize, out: [*]u8) i32 {
    var mac: [HmacSha256.mac_length]u8 = undefined;
    HmacSha256.create(&mac, msg_ptr[0..msg_len], key_ptr[0..key_len]);
    @memcpy(out[0..HmacSha256.mac_length], &mac);
    return OK;
}

export fn zig_sha256(msg_ptr: [*]const u8, msg_len: usize, out: [*]u8) i32 {
    var h: [Sha256.digest_length]u8 = undefined;
    Sha256.hash(msg_ptr[0..msg_len], &h, .{});
    @memcpy(out[0..Sha256.digest_length], &h);
    return OK;
}

// ============ AES-256-GCM encrypt (oneshot) ============
// Encrypts plaintext with key+nonce. Writes ciphertext+tag to out.
// out must have room for in_len + TAG_LEN bytes.
// Returns total bytes written (in_len + TAG_LEN), or 0 on error.
export fn zig_gcm_encrypt(key: [*]const u8, nonce: [*]const u8, in_ptr: [*]const u8, in_len: usize, out: [*]u8) usize {
    if (in_len == 0) {
        // GCM can encrypt empty plaintext — just produce the tag
        var tag: [TAG_LEN]u8 = undefined;
        Aes256Gcm.encrypt(out[0..0], &tag, "", "", nonce_to_array(nonce), key_ptr_to_array(key));
        @memcpy(out[0..TAG_LEN], &tag);
        return TAG_LEN;
    }
    var tag: [TAG_LEN]u8 = undefined;
    Aes256Gcm.encrypt(out[0..in_len], &tag, in_ptr[0..in_len], "", nonce_to_array(nonce), key_ptr_to_array(key));
    @memcpy(out[in_len .. in_len + TAG_LEN], &tag);
    return in_len + TAG_LEN;
}

// ============ AES-256-GCM decrypt (oneshot) ============
// Decrypts ciphertext+tag with key+nonce. Writes plaintext to out.
// in_len must be >= TAG_LEN (ciphertext + tag concatenated).
// out must have room for in_len - TAG_LEN bytes.
// Returns plaintext length, or ERR_BAD_TAG (-2) on authentication failure.
export fn zig_gcm_decrypt(key: [*]const u8, nonce: [*]const u8, in_ptr: [*]const u8, in_len: usize, out: [*]u8) i64 {
    if (in_len < TAG_LEN) return ERR_BAD_TAG;
    const ct_len = in_len - TAG_LEN;
    const tag_slice = in_ptr[ct_len .. ct_len + TAG_LEN];
    var tag: [TAG_LEN]u8 = undefined;
    @memcpy(&tag, tag_slice);
    Aes256Gcm.decrypt(out[0..ct_len], in_ptr[0..ct_len], tag, "", nonce_to_array(nonce), key_ptr_to_array(key)) catch return ERR_BAD_TAG;
    return @intCast(ct_len);
}

// ---- helpers ----
fn key_ptr_to_array(key: [*]const u8) [KEY_LEN]u8 {
    var arr: [KEY_LEN]u8 = undefined;
    @memcpy(&arr, key[0..KEY_LEN]);
    return arr;
}
fn nonce_to_array(nonce: [*]const u8) [NONCE_LEN]u8 {
    var arr: [NONCE_LEN]u8 = undefined;
    @memcpy(&arr, nonce[0..NONCE_LEN]);
    return arr;
}

// ============ metadata accessors ============
export fn zig_block_len() usize { return BLOCK_LEN; }
export fn zig_key_len() usize { return KEY_LEN; }
export fn zig_nonce_len() usize { return NONCE_LEN; }
export fn zig_tag_len() usize { return TAG_LEN; }
export fn zig_salt_len() usize { return SALT_LEN; }
export fn zig_pbkdf2_iters() u32 { return PBKDF2_ITERS; }
