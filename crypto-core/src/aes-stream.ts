// Streaming AES-256-CBC engine built on the raw AES block cipher (aes-js).
// Using a raw block-cipher library gives full control over IV chaining and lets us
// process data in arbitrary-size chunks WITHOUT per-chunk padding — enabling true
// low-memory streaming of TB-scale files. PKCS7 padding is applied only once, to
// the final block. Identical behaviour in browser (WebWorker) and Bun.
import aesjs from "aes-js";
import { BLOCK_LEN, pkcs7Pad, pkcs7Unpad } from "./compat.js";

/**
 * Streaming CBC encryption.
 * @param key 32-byte AES key
 * @param iv 16-byte IV
 * @param plaintext async iterable of plaintext chunks (any sizes)
 * @yields ciphertext chunks (16-byte multiples). Final chunk includes PKCS7 padding.
 */
export async function* cbcEncryptStream(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: AsyncIterable<Uint8Array>
): AsyncGenerator<Uint8Array> {
  const cbc = new aesjs.ModeOfOperation.cbc(key as unknown as number[], iv as unknown as number[]);
  let carry = new Uint8Array(0);

  for await (const chunk of plaintext) {
    if (chunk.length === 0) continue;
    // merge carry + chunk
    const merged = new Uint8Array(carry.length + chunk.length);
    merged.set(carry, 0);
    merged.set(chunk, carry.length);
    // only complete 16-byte blocks are encrypted now; remainder waits
    const processLen = Math.floor(merged.length / BLOCK_LEN) * BLOCK_LEN;
    if (processLen > 0) {
      const toEncrypt = merged.subarray(0, processLen);
      const cipher = cbc.encrypt(toEncrypt as unknown as number[]) as Uint8Array;
      yield cipher;
      carry = merged.subarray(processLen);
    } else {
      carry = merged;
    }
  }

  // Final block: PKCS7-pad whatever remains (0..15 bytes) and encrypt.
  const finalBlock = pkcs7Pad(carry);
  const cipher = cbc.encrypt(finalBlock as unknown as number[]) as Uint8Array;
  yield cipher;
}

/**
 * Streaming CBC decryption.
 * Holds back the final 16-byte block until the stream ends so PKCS7 padding can be
 * stripped exactly once. Memory footprint ≈ one chunk + 16 bytes.
 */
export async function* cbcDecryptStream(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: AsyncIterable<Uint8Array>
): AsyncGenerator<Uint8Array> {
  const cbc = new aesjs.ModeOfOperation.cbc(key as unknown as number[], iv as unknown as number[]);
  let carry = new Uint8Array(0);

  for await (const chunk of ciphertext) {
    if (chunk.length === 0) continue;
    const merged = new Uint8Array(carry.length + chunk.length);
    merged.set(carry, 0);
    merged.set(chunk, carry.length);
    // Reserve the last 16 bytes (potential final padded block).
    if (merged.length > BLOCK_LEN) {
      const safe = merged.length - BLOCK_LEN;
      const processLen = Math.floor(safe / BLOCK_LEN) * BLOCK_LEN;
      if (processLen > 0) {
        const toDecrypt = merged.subarray(0, processLen);
        const plain = cbc.decrypt(toDecrypt as unknown as number[]) as Uint8Array;
        yield plain;
        carry = merged.subarray(processLen);
      } else {
        carry = merged;
      }
    } else {
      carry = merged;
    }
  }

  if (carry.length !== BLOCK_LEN) {
    throw new Error("Corrupted ciphertext: final block is not 16 bytes");
  }
  const lastPlain = cbc.decrypt(carry as unknown as number[]) as Uint8Array;
  yield pkcs7Unpad(lastPlain);
}

/**
 * ByteReader: pulls bytes on demand from an async iterable, buffering across chunk
 * boundaries. Used to parse the fixed + variable-length file header, then expose the
 * remaining bytes as a ciphertext body stream.
 */
export class ByteReader {
  private buf: Uint8Array = new Uint8Array(0);
  private iter: AsyncIterator<Uint8Array>;
  private done = false;

  constructor(source: AsyncIterable<Uint8Array>) {
    this.iter = source[Symbol.asyncIterator]();
  }

  private async fillUntil(need: number): Promise<boolean> {
    while (this.buf.length < need) {
      const r = await this.iter.next();
      if (r.done) {
        this.done = true;
        return false;
      }
      const chunk = r.value as Uint8Array;
      const merged = new Uint8Array(this.buf.length + chunk.length);
      merged.set(this.buf, 0);
      merged.set(chunk, this.buf.length);
      this.buf = merged;
    }
    return true;
  }

  /** Read exactly n bytes. Throws if the stream ends before n bytes. */
  async read(n: number): Promise<Uint8Array> {
    const ok = await this.fillUntil(n);
    if (!ok && this.buf.length < n) {
      throw new Error(`Unexpected end of stream (wanted ${n}, have ${this.buf.length})`);
    }
    const out = this.buf.subarray(0, n);
    this.buf = this.buf.subarray(n);
    return out;
  }

  /** Read a little-endian uint32. */
  async readU32(): Promise<number> {
    const b = await this.read(4);
    return (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  }

  /** Remaining buffered bytes + the rest of the underlying stream, as an async iterable. */
  remaining(): AsyncIterable<Uint8Array> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        let emittedBuf = false;
        return {
          async next() {
            if (!emittedBuf) {
              emittedBuf = true;
              if (self.buf.length > 0) {
                const b = self.buf;
                self.buf = new Uint8Array(0);
                return { value: b, done: false };
              }
            }
            const r = await self.iter.next();
            if (r.done) return { value: undefined, done: true };
            return { value: r.value as Uint8Array, done: false };
          },
        };
      },
    };
  }
}

/** Convert a ReadableStream<Uint8Array> (e.g. fetch body) to an async iterable. */
export function streamToAsyncIterable<T extends Uint8Array>(
  stream: ReadableStream<T>
): AsyncIterable<T> {
  const reader = stream.getReader();
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          const r = await reader.read();
          if (r.done) return { value: undefined, done: true };
          return { value: r.value as T, done: false };
        },
        async return() {
          try { await reader.cancel(); } catch {}
          return { value: undefined, done: true };
        },
      };
    },
  };
}
