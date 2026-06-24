// WebWorker: runs all crypto locally via Zig-compiled crypto.wasm (AES-256-GCM).
// Streams chunks to main thread ONE AT A TIME (not collected in memory).
// Main thread writes chunks directly to file via File System Access API
// (showSaveFilePicker) or falls back to Blob for older browsers.
import { getZigCore } from "@crypto-core/src/zig-loader-web";
import {
  encryptFileStream,
  decryptFileStream,
  inspectFileStream,
  encryptTextToBase64,
  decryptTextFromBase64,
  bytesToBase64,
  utf8Encode,
  type FileMeta,
} from "@crypto-core/src/format";

let coreReady: Promise<any> | null = null;
function core() { if (!coreReady) coreReady = getZigCore(); return coreReady; }

type Req =
  | { id: number; type: "encryptFile"; file: File; password: string; meta: FileMeta; thumbnail?: Uint8Array; saveFilename?: string }
  | { id: number; type: "decryptFile"; file: File; password: string; saveFilename?: string }
  | { id: number; type: "inspectFile"; file: File }
  | { id: number; type: "encryptText"; text: string; password: string; note?: string }
  | { id: number; type: "decryptText"; base64: string; password: string };

function post(msg: any, transfer?: Transferable[]) {
  if (transfer) (self as any).postMessage(msg, transfer);
  else (self as any).postMessage(msg);
}

function bytesIter(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return { [Symbol.asyncIterator]() {
    let sent = false;
    return { async next() { if (sent) return { value: undefined, done: true as const }; sent = true; return { value: bytes, done: false as const }; } };
  } };
}

// Stream a file's ReadableStream in chunks for encryption input
function fileStreamIter(stream: ReadableStream<Uint8Array>, id: number, total: number, phase: string): AsyncIterable<Uint8Array> {
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
  } };
}

async function handle(req: Req) {
  const { id, type } = req;
  try {
    const c = await core();
    if (type === "encryptFile") {
      const { file, password, meta, thumbnail } = req;
      const stream = file.stream() as ReadableStream<Uint8Array>;
      // Stream: yield each encrypted chunk → post to main thread immediately
      let totalSize = 0;
      for await (const chunk of encryptFileStream({
        core: c, meta, thumbnail, password: utf8Encode(password),
        plaintext: fileStreamIter(stream, id, file.size, "加密中"),
        onProgress: (done, total) => post({ id, type: "progress", done, total, phase: "加密中" }),
      })) {
        // Copy chunk data (don't transfer — transfer can cause detached buffer issues)
        const copy = new Uint8Array(chunk.length);
        copy.set(chunk);
        post({ id, type: "chunk", data: copy.buffer });
        totalSize += chunk.length;
      }
      post({ id, type: "done", size: totalSize, saveFilename: req.saveFilename });
    } else if (type === "decryptFile") {
      const { file, password } = req;
      // For decrypt, we need to read the file to get the header (for MIME type)
      // But we stream the ciphertext to the decryptor chunk by chunk
      const bytes = new Uint8Array(await file.arrayBuffer());
      let m: FileMeta | null = null; let thumbnailBase64: string | undefined;
      try { const insp = await inspectFileStream(bytesIter(bytes)); m = insp.meta; if (insp.thumbnail && insp.thumbnail.length) thumbnailBase64 = bytesToBase64(insp.thumbnail); } catch {}
      post({ id, type: "progress", done: 0, total: m?.originalSize || bytes.length, phase: "解密中" });
      for await (const chunk of decryptFileStream({
        core: c, password: utf8Encode(password), ciphertext: bytesIter(bytes),
        onProgress: (done, total) => post({ id, type: "progress", done, total, phase: "解密中" }),
      })) {
        const copy = new Uint8Array(chunk.length);
        copy.set(chunk);
        post({ id, type: "chunk", data: copy.buffer });
      }
      post({ id, type: "done", size: m?.originalSize || 0, meta: m, thumbnailBase64, saveFilename: req.saveFilename || m?.originalName });
    } else if (type === "inspectFile") {
      const bytes = new Uint8Array(await req.file.arrayBuffer());
      const insp = await inspectFileStream(bytesIter(bytes));
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
