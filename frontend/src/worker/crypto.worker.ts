// WebWorker: runs all crypto locally via Zig-compiled crypto.wasm (AES-256-GCM).
// Streams file data — NEVER loads the entire file into memory.
// Uses file.stream() for both inspect and decrypt (iOS Safari safe).
import { getZigCore } from "@crypto-core/src/zig-loader-web";
import {
  encryptFileStream,
  decryptFileStream,
  inspectFileStream,
  encryptTextToBase64,
  decryptTextFromBase64,
  bytesToBase64,
  utf8Encode,
  utf8Decode,
  type FileMeta,
} from "@crypto-core/src/format";

let coreReady: Promise<any> | null = null;
function core() { if (!coreReady) coreReady = getZigCore(); return coreReady; }

type Req =
  | { id: number; type: "encryptFile"; file: File; password: string; meta: FileMeta; thumbnail?: Uint8Array }
  | { id: number; type: "decryptFile"; file: File; password: string }
  | { id: number; type: "inspectFile"; file: File }
  | { id: number; type: "encryptText"; text: string; password: string; note?: string }
  | { id: number; type: "decryptText"; base64: string; password: string };

function post(msg: any) { (self as any).postMessage(msg); }

/** Convert a ReadableStream to AsyncIterable (for file.stream()). */
function streamIter(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  return { [Symbol.asyncIterator]() {
    return {
      async next() {
        const r = await reader.read();
        if (r.done) return { value: undefined, done: true as const };
        return { value: r.value as Uint8Array, done: false as const };
      },
      async return() { try { await reader.cancel(); } catch {} return { value: undefined, done: true as const }; },
    };
  }};
}

/** File stream with progress reporting. */
function fileStreamWithProgress(stream: ReadableStream<Uint8Array>, id: number, total: number, phase: string): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  return { [Symbol.asyncIterator]() {
    let done = 0;
    return {
      async next() {
        const r = await reader.read();
        if (r.done) return { value: undefined, done: true as const };
        const v = r.value as Uint8Array; done += v.length;
        post({ id, type: "progress", done, total, phase });
        return { value: v, done: false as const };
      },
      async return() { try { await reader.cancel(); } catch {} return { value: undefined, done: true as const }; },
    };
  }};
}

async function handle(req: Req) {
  const { id, type } = req;
  try {
    const c = await core();
    if (type === "encryptFile") {
      const { file, password, meta, thumbnail } = req;
      const stream = file.stream() as ReadableStream<Uint8Array>;
      let totalSize = 0;
      for await (const chunk of encryptFileStream({
        core: c, meta, thumbnail, password: utf8Encode(password),
        plaintext: fileStreamWithProgress(stream, id, file.size, "加密中"),
        onProgress: (done, total) => post({ id, type: "progress", done, total, phase: "加密中" }),
      })) {
        const copy = new Uint8Array(chunk.length);
        copy.set(chunk);
        post({ id, type: "chunk", data: copy.buffer });
        totalSize += chunk.length;
      }
      post({ id, type: "done", size: totalSize });
    } else if (type === "decryptFile") {
      const { file, password } = req;
      // Stream the file directly — do NOT load into memory via arrayBuffer()
      const stream = file.stream() as ReadableStream<Uint8Array>;
      const streamReader = stream.getReader();

      // First pass: read just enough for inspect (header only)
      // ByteReader will buffer just the header and stop
      const inspectIter: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              const r = await streamReader.read();
              if (r.done) return { value: undefined, done: true as const };
              return { value: r.value as Uint8Array, done: false as const };
            },
          };
        },
      };

      // We can't use inspectFileStream directly because it consumes the stream.
      // Instead, read the header manually, then feed [header + remaining] to decrypt.
      // Read enough for: magic(4) + ver(1) + flags(1) + rsv(2) + jsonLen(4) = 12 bytes
      let buf = new Uint8Array(0);
      let m: FileMeta | null = null;
      let thumbnailBase64: string | undefined;

      // Read until we have the full header
      const readMore = async (need: number) => {
        while (buf.length < need) {
          const r = await streamReader.read();
          if (r.done) break;
          const merged = new Uint8Array(buf.length + r.value.length);
          merged.set(buf, 0);
          merged.set(r.value, buf.length);
          buf = merged;
        }
      };

      await readMore(12);
      if (utf8Decode(buf.subarray(0, 4)) !== "ENC1") throw new Error("Not ENC1");
      if (buf[4] !== 2) throw new Error("Unsupported version");
      const jl = (buf[8] | (buf[9] << 8) | (buf[10] << 16) | (buf[11] << 24)) >>> 0;
      await readMore(12 + jl + 4); // + jsonLen + thumbnailLen
      const tl = (buf[12 + jl] | (buf[13 + jl] << 8) | (buf[14 + jl] << 16) | (buf[15 + jl] << 24)) >>> 0;
      const fullHeader = 12 + jl + 4 + tl + 16 + 12 + 4; // +thumb +salt +nonce +chunkSize
      await readMore(fullHeader);

      m = JSON.parse(utf8Decode(buf.subarray(12, 12 + jl)));
      if (tl > 0) {
        const thumb = buf.subarray(12 + jl + 4, 12 + jl + 4 + tl);
        thumbnailBase64 = bytesToBase64(thumb);
      }

      // Remaining data in buf (ciphertext) + rest of stream
      const remaining = buf.subarray(fullHeader);
      const ciphertextIter: AsyncIterable<Uint8Array> = {
        [Symbol.asyncIterator]() {
          let sentRemaining = false;
          return {
            async next() {
              if (!sentRemaining) {
                sentRemaining = true;
                if (remaining.length > 0) return { value: remaining, done: false as const };
              }
              const r = await streamReader.read();
              if (r.done) return { value: undefined, done: true as const };
              return { value: r.value as Uint8Array, done: false as const };
            },
          };
        },
      };

      post({ id, type: "progress", done: 0, total: m?.originalSize || 0, phase: "解密中" });
      for await (const chunk of decryptFileStream({
        core: c, password: utf8Encode(password), ciphertext: ciphertextIter,
        onProgress: (done, total) => post({ id, type: "progress", done, total, phase: "解密中" }),
      })) {
        const copy = new Uint8Array(chunk.length);
        copy.set(chunk);
        post({ id, type: "chunk", data: copy.buffer });
      }
      post({ id, type: "done", size: m?.originalSize || 0, meta: m, thumbnailBase64 });
    } else if (type === "inspectFile") {
      // Stream inspect — don't load entire file
      const stream = req.file.stream() as ReadableStream<Uint8Array>;
      const insp = await inspectFileStream(streamIter(stream));
      post({ id, type: "done", meta: insp.meta, hasThumbnail: !!insp.thumbnail && insp.thumbnail.length > 0, thumbnailBase64: insp.thumbnail && insp.thumbnail.length ? bytesToBase64(insp.thumbnail) : undefined, dataOffset: insp.dataOffset });
    } else if (type === "encryptText") {
      const data = await encryptTextToBase64(c, req.text, utf8Encode(req.password), req.note || "");
      post({ id, type: "done", data });
    } else if (type === "decryptText") {
      const { text, meta } = await decryptTextFromBase64(c, req.base64, utf8Encode(req.password));
      post({ id, type: "done", text, meta });
    }
  } catch (e: any) { post({ id, type: "error", message: e?.message || String(e) }); }
}

self.addEventListener("message", (e: MessageEvent<Req>) => handle(e.data));
