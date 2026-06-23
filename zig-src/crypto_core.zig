// crypto_core.zig — Unified AES-256-CBC streaming encryption core in Zig 0.14.
//
// ONE source compiled to two artifacts:
//   * crypto.wasm            (wasm32-freestanding)  — browser WebWorker
//   * libcryptocore.so/.dll  (native)               — Bun backend via bun:ffi
//
// Zig 0.14 API notes:
//   * AES-256:  std.crypto.aead.aes.Aes256  (initEnc/initDec → ctx.encrypt/decrypt)
//   * PBKDF2:   std.crypto.pwhash.pbkdf2(dk, password, salt, rounds, Prf)
//   * HMAC:     std.crypto.auth.hmac.HmacSha256
//   * SHA256:   std.crypto.hash.sha2.Sha256

const std = @import("std");
const crypto = std.crypto;
const Aes256 = crypto.core.aes.Aes256;
const HmacSha256 = crypto.auth.hmac.sha2.HmacSha256;
const Sha256 = crypto.hash.sha2.Sha256;
const pbkdf2 = crypto.pwhash.pbkdf2;

pub const BLOCK_LEN: usize = 16;
pub const KEY_LEN: usize = 32;
pub const IV_LEN: usize = 16;
pub const SALT_LEN: usize = 16;
pub const PBKDF2_ITERS: u32 = 100_000;

pub const OK: i32 = 0;
pub const ERR_BAD_LEN: i32 = -1;
pub const ERR_BAD_PADDING: i32 = -2;
pub const ERR_BAD_STATE: i32 = -3;

const CbcCtx = extern struct {
    key: [KEY_LEN]u8,
    iv: [BLOCK_LEN]u8,
    carry_len: u8,
    carry: [BLOCK_LEN]u8,
    decrypt: u8,
};

const MAX_CTX = 64;
var ctx_pool: [MAX_CTX]CbcCtx = undefined;
var ctx_used = [_]bool{false} ** MAX_CTX;

fn alloc_ctx() ?*CbcCtx {
    for (&ctx_used, 0..) |*u, i| {
        if (!u.*) { u.* = true; return &ctx_pool[i]; }
    }
    return null;
}
fn free_ctx(c: *CbcCtx) void {
    const idx = (@intFromPtr(c) - @intFromPtr(&ctx_pool[0])) / @sizeOf(CbcCtx);
    if (idx < MAX_CTX) ctx_used[idx] = false;
}

// ---- JS scratch heap (managed by Zig, past all static data) ----
// JS calls zig_alloc to get a pointer for input/output buffers. This avoids
// collisions with Zig's static data (ctx_pool etc.) that caused "memory access
// out of bounds" when the JS-side bump allocator started at address 0.
// 64MB is enough for large file chunks (the worker feeds data in chunks, not
// all at once). If a single allocation exceeds this, zig_alloc wraps around.
const JS_HEAP_SIZE: usize = 64 * 1024 * 1024; // 64MB scratch
var js_heap: [JS_HEAP_SIZE]u8 = undefined;
var js_heap_off: usize = 0;

export fn zig_alloc(n: usize) [*]u8 {
    const aligned = (js_heap_off + 15) & ~@as(usize, 15);
    if (aligned + n > JS_HEAP_SIZE) {
        // wrap around (single-threaded, sequential calls)
        js_heap_off = 0;
        return @ptrCast(&js_heap[0]);
    }
    js_heap_off = aligned + n;
    return @ptrCast(&js_heap[aligned]);
}

// Hash a password-derived key to an emoji index (0..95). One-way: uses the
// PBKDF2-derived key (already 100k iterations) so precomputing a rainbow table
// is expensive. Returns the emoji index, not the emoji itself (JS has the table).
export fn zig_password_emoji(key_ptr: [*]const u8, key_len: usize) u32 {
    var sum: u32 = 0;
    var i: usize = 0;
    while (i < key_len) : (i += 1) {
        sum +%= key_ptr[i];
    }
    return sum % 96;
}

// ============ exported C-ABI functions ============

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

// ---- CBC encrypt streaming ----

export fn zig_cbc_encrypt_begin(key: [*]const u8, iv: [*]const u8) ?*CbcCtx {
    const c = alloc_ctx() orelse return null;
    @memcpy(&c.key, key[0..KEY_LEN]);
    @memcpy(&c.iv, iv[0..BLOCK_LEN]);
    c.carry_len = 0;
    c.decrypt = 0;
    return c;
}

export fn zig_cbc_encrypt_update(ctx: *CbcCtx, in_ptr: [*]const u8, in_len: usize, out: [*]u8) usize {
    const carry = @as(usize, ctx.carry_len);
    const total = carry + in_len;
    var written: usize = 0;
    var pos: usize = 0;
    const enc = Aes256.initEnc(ctx.key);
    while (pos + BLOCK_LEN <= total) {
        var block: [BLOCK_LEN]u8 = undefined;
        gather_block(ctx, in_ptr, pos, carry, &block);
        var x: [BLOCK_LEN]u8 = undefined;
        for (0..BLOCK_LEN) |k| x[k] = block[k] ^ ctx.iv[k];
        var ct: [BLOCK_LEN]u8 = undefined;
        enc.encrypt(&ct, &x);
        @memcpy(&ctx.iv, &ct);
        @memcpy(out[written .. written + BLOCK_LEN], &ct);
        written += BLOCK_LEN;
        pos += BLOCK_LEN;
    }
    const remaining = total - pos;
    if (remaining > 0) gather_range(ctx, in_ptr, pos, carry, ctx.carry[0..remaining]);
    ctx.carry_len = @intCast(remaining);
    return written;
}

export fn zig_cbc_encrypt_final(ctx: *CbcCtx, out: [*]u8) usize {
    var block: [BLOCK_LEN]u8 = undefined;
    const cl = @as(usize, ctx.carry_len);
    @memcpy(block[0..cl], ctx.carry[0..cl]);
    const pad: u8 = @intCast(BLOCK_LEN - cl);
    var k: usize = cl;
    while (k < BLOCK_LEN) : (k += 1) block[k] = pad;
    const enc = Aes256.initEnc(ctx.key);
    var x: [BLOCK_LEN]u8 = undefined;
    for (0..BLOCK_LEN) |j| x[j] = block[j] ^ ctx.iv[j];
    var ct: [BLOCK_LEN]u8 = undefined;
    enc.encrypt(&ct, &x);
    @memcpy(out[0..BLOCK_LEN], &ct);
    free_ctx(ctx);
    return BLOCK_LEN;
}

// ---- CBC decrypt streaming ----

export fn zig_cbc_decrypt_begin(key: [*]const u8, iv: [*]const u8) ?*CbcCtx {
    const c = alloc_ctx() orelse return null;
    @memcpy(&c.key, key[0..KEY_LEN]);
    @memcpy(&c.iv, iv[0..BLOCK_LEN]);
    c.carry_len = 0;
    c.decrypt = 1;
    return c;
}

export fn zig_cbc_decrypt_update(ctx: *CbcCtx, in_ptr: [*]const u8, in_len: usize, out: [*]u8) usize {
    const cl = @as(usize, ctx.carry_len);
    const total = cl + in_len;
    if (total < BLOCK_LEN) {
        @memcpy(ctx.carry[cl .. cl + in_len], in_ptr[0..in_len]);
        ctx.carry_len = @intCast(total);
        return 0;
    }
    const process_total = total - BLOCK_LEN;
    const process_bytes = (process_total / BLOCK_LEN) * BLOCK_LEN;
    var written: usize = 0;
    var pos: usize = 0;
    const dec = Aes256.initDec(ctx.key);
    while (pos < process_bytes) : (pos += BLOCK_LEN) {
        var block: [BLOCK_LEN]u8 = undefined;
        gather_block(ctx, in_ptr, pos, cl, &block);
        var pt: [BLOCK_LEN]u8 = undefined;
        dec.decrypt(&pt, &block);
        var x: [BLOCK_LEN]u8 = undefined;
        for (0..BLOCK_LEN) |j| x[j] = pt[j] ^ ctx.iv[j];
        @memcpy(&ctx.iv, &block);
        @memcpy(out[written .. written + BLOCK_LEN], &x);
        written += BLOCK_LEN;
    }
    gather_range(ctx, in_ptr, process_bytes, cl, ctx.carry[0..BLOCK_LEN]);
    ctx.carry_len = BLOCK_LEN;
    return written;
}

export fn zig_cbc_decrypt_final(ctx: *CbcCtx, out: [*]u8) i64 {
    if (ctx.carry_len != BLOCK_LEN) { free_ctx(ctx); return ERR_BAD_STATE; }
    const dec = Aes256.initDec(ctx.key);
    var pt: [BLOCK_LEN]u8 = undefined;
    dec.decrypt(&pt, &ctx.carry);
    var x: [BLOCK_LEN]u8 = undefined;
    for (0..BLOCK_LEN) |j| x[j] = pt[j] ^ ctx.iv[j];
    const pad = x[BLOCK_LEN - 1];
    if (pad < 1 or pad > BLOCK_LEN) { free_ctx(ctx); return ERR_BAD_PADDING; }
    var k: usize = BLOCK_LEN - pad;
    while (k < BLOCK_LEN) : (k += 1) { if (x[k] != pad) { free_ctx(ctx); return ERR_BAD_PADDING; } }
    const out_len: usize = BLOCK_LEN - pad;
    @memcpy(out[0..out_len], x[0..out_len]);
    free_ctx(ctx);
    return @intCast(out_len);
}

// ---- single-shot ----

export fn zig_cbc_encrypt_oneshot(key: [*]const u8, iv: [*]const u8, in_ptr: [*]const u8, in_len: usize, out: [*]u8) usize {
    const ctx = zig_cbc_encrypt_begin(key, iv) orelse return 0;
    var written: usize = 0;
    if (in_len > 0) written += zig_cbc_encrypt_update(ctx, in_ptr, in_len, out);
    written += zig_cbc_encrypt_final(ctx, out + written);
    return written;
}

export fn zig_cbc_decrypt_oneshot(key: [*]const u8, iv: [*]const u8, in_ptr: [*]const u8, in_len: usize, out: [*]u8) i64 {
    const ctx = zig_cbc_decrypt_begin(key, iv) orelse return ERR_BAD_STATE;
    var written: usize = 0;
    if (in_len > 0) written += zig_cbc_decrypt_update(ctx, in_ptr, in_len, out);
    const final_len = zig_cbc_decrypt_final(ctx, out + written);
    if (final_len < 0) return final_len;
    return @intCast(written + @as(usize, @intCast(final_len)));
}

// ---- metadata ----
export fn zig_block_len() usize { return BLOCK_LEN; }
export fn zig_key_len() usize { return KEY_LEN; }
export fn zig_iv_len() usize { return IV_LEN; }
export fn zig_salt_len() usize { return SALT_LEN; }
export fn zig_pbkdf2_iters() u32 { return PBKDF2_ITERS; }

// ---- internal gather helpers ----
fn gather_block(ctx: *CbcCtx, in_ptr: [*]const u8, pos: usize, carry: usize, block: *[BLOCK_LEN]u8) void {
    if (pos < carry) {
        const from_carry = carry - pos;
        const take_carry = if (from_carry >= BLOCK_LEN) BLOCK_LEN else from_carry;
        @memcpy(block[0..take_carry], ctx.carry[pos .. pos + take_carry]);
        if (take_carry < BLOCK_LEN) @memcpy(block[take_carry..BLOCK_LEN], in_ptr[0 .. BLOCK_LEN - take_carry]);
    } else {
        @memcpy(block[0..BLOCK_LEN], in_ptr[pos - carry .. pos - carry + BLOCK_LEN]);
    }
}
fn gather_range(ctx: *CbcCtx, in_ptr: [*]const u8, pos: usize, carry: usize, dest: []u8) void {
    const len = dest.len;
    if (pos < carry) {
        const from_carry = carry - pos;
        const take_carry = if (from_carry >= len) len else from_carry;
        @memcpy(dest[0..take_carry], ctx.carry[pos .. pos + take_carry]);
        if (take_carry < len) @memcpy(dest[take_carry..len], in_ptr[0 .. len - take_carry]);
    } else {
        @memcpy(dest[0..len], in_ptr[pos - carry .. pos - carry + len]);
    }
}
