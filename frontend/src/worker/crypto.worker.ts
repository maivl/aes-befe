// WebWorker: runs all crypto locally via Zig-compiled crypto.wasm (AES-256-GCM).
// Key fix: Worker writes decrypted chunks DIRECTLY to OPFS (no postMessage for
// chunks → no memory doubling → no iOS Safari OOM).
// Worker has access to navigator.storage.getDirectory() — can create OPFS files.
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

function streamIter(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  return { [Symbol.asyncIterator]() {
    return {
      async next() { const r = await reader.read(); if (r.done) return { value: undefined, done: true as const }; return { value: r.value as Uint8Array, done: false as const }; },
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
      // For encrypt: collect chunks into Blob (encrypted .enc is downloaded by user)
      const parts: Uint8Array[] = [];
      for await (const chunk of encryptFileStream({
        core: c, meta, thumbnail, password: utf8Encode(password),
        plaintext: streamIter(stream),
        onProgress: (done, total) => post({ id, type: "progress", done, total, phase: "加密中" }),
      })) {
        // Copy chunk (it's a view into wasm memory which gets reset on next call)
        parts.push(new Uint8Array(chunk));
      }
      const blob = new Blob(parts, { type: "application/octet-stream" });
      post({ id, type: "done", blob, size: blob.size });

    } else if (type === "decryptFile") {
      const { file, password } = req;
      // Stream the file — do NOT load via arrayBuffer()
      const stream = file.stream() as ReadableStream<Uint8Array>;
      const reader = stream.getReader();

      // --- Parse header by reading just enough bytes ---
      let buf = new Uint8Array(0);
      const readMore = async (need: number) => {
        while (buf.length < need) {
          const r = await reader.read();
          if (r.done) break;
          const merged = new Uint8Array(buf.length + r.value.length);
          merged.set(buf, 0); merged.set(r.value, buf.length);
          buf = merged;
        }
      };
      await readMore(12);
      if (utf8Decode(buf.subarray(0, 4)) !== "ENC1") throw new Error("Not ENC1");
      if (buf[4] !== 2) throw new Error("Unsupported version");
      const jl = (buf[8] | (buf[9] << 8) | (buf[10] << 16) | (buf[11] << 24)) >>> 0;
      await readMore(12 + jl + 4);
      const tl = (buf[12 + jl] | (buf[13 + jl] << 8) | (buf[14 + jl] << 16) | (buf[15 + jl] << 24)) >>> 0;
      const fullHeader = 12 + jl + 4 + tl + 16 + 12 + 4;
      await readMore(fullHeader);

      const meta: FileMeta = JSON.parse(utf8Decode(buf.subarray(12, 12 + jl)));
      let thumbnailBase64: string | undefined;
      if (tl > 0) {
        const thumb = buf.subarray(12 + jl + 4, 12 + jl + 4 + tl);
        thumbnailBase64 = bytesToBase64(thumb);
      }

      // --- Set up OPFS for direct write (Worker can access OPFS!) ---
      // This is the key fix: write decrypted chunks to OPFS inside the worker,
      // avoiding postMessage chunk transfer (which doubles memory on iOS Safari).
      const opfsAvailable = typeof (self as any).navigator?.storage?.getDirectory === "function";
      let opfsRoot: any = null, opfsFileHandle: any = null, opfsWriter: any = null;
      const blobParts: Uint8Array[] = [];
      let totalSize = 0;

      if (opfsAvailable) {
        try {
          opfsRoot = await (self as any).navigator.storage.getDirectory();
          const safeName = (meta.originalName || "decrypted").replace(/[^a-zA-Z0-9._-]/g, "_");
          opfsFileHandle = await opfsRoot.getFileHandle(safeName, { create: true });
          const writable = await opfsFileHandle.createWritable();
          opfsWriter = writable.getWriter();
        } catch { opfsWriter = null; }
      }

      // --- Combined ciphertext iterable ---
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
              const r = await reader.read();
              if (r.done) return { value: undefined, done: true as const };
              return { value: r.value as Uint8Array, done: false as const };
            },
          };
        },
      };

      post({ id, type: "progress", done: 0, total: meta.originalSize, phase: "解密中" });

      // --- Decrypt chunk by chunk, write directly to OPFS (no postMessage!) ---
      try {
        for await (const chunk of decryptFileStream({
          core: c, password: utf8Encode(password), ciphertext: ciphertextIter,
          onProgress: (done, total) => post({ id, type: "progress", done, total, phase: "解密中" }),
        })) {
          totalSize += chunk.length;
          if (opfsWriter) {
            // Write directly to OPFS — chunk stays in wasm heap, no copy needed
            await opfsWriter.write(new Uint8Array(chunk));
          } else {
            // Fallback: collect in memory (for browsers without OPFS)
            blobParts.push(new Uint8Array(chunk));
          }
        }
      } catch (e) {
        if (opfsWriter) { try { await opfsWriter.abort(); } catch {} }
        throw e;
      }

      // --- Finalize ---
      if (opfsWriter) {
        await opfsWriter.close();
        // Don't create URL in worker — worker URLs aren't accessible from main thread.
        // Just send the OPFS filename; main thread opens the file and creates URL.
        post({ id, type: "done", size: totalSize, meta, thumbnailBase64, opfsName: opfsFileHandle.name });
      } else {
        // Blob fallback — transfer the blob to main thread
        const blob = new Blob(blobParts, { type: meta.mimeType || "application/octet-stream" });
        post({ id, type: "done", blob, size: blob.size, meta, thumbnailBase64 });
      }

    } else if (type === "inspectFile") {
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
