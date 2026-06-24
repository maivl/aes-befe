// WebWorker: runs all crypto locally via Zig-compiled crypto.wasm (AES-256-GCM).
// Streams file data — NEVER loads the entire file into memory.
// For decrypt/encrypt: writes chunks directly to OPFS inside the worker.
// Uses createSyncAccessHandle (worker-only sync API) for iOS Safari compatibility.
// Falls back to Blob (postMessage) when OPFS unavailable.
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

// OPFS: use createSyncAccessHandle (worker-only, iOS Safari compatible)
// Falls back to createWritable (main-thread style) if sync not available.
function isOPFSAvailable(): boolean {
  return typeof (self as any).navigator?.storage?.getDirectory === "function";
}

async function createOPFSWriter(filename: string) {
  if (!isOPFSAvailable()) return null;
  try {
    const root = await (self as any).navigator.storage.getDirectory();
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const handle = await root.getFileHandle(safeName, { create: true });
    // Try createSyncAccessHandle first (worker-only, iOS Safari compatible)
    if (typeof handle.createSyncAccessHandle === "function") {
      const syncHandle = await handle.createSyncAccessHandle();
      return {
        type: "sync" as const,
        write: (data: Uint8Array) => syncHandle.write(data),
        close: () => syncHandle.close(),
        handle,
        root,
        name: safeName,
      };
    }
    // Fall back to createWritable (Chrome, Firefox)
    if (typeof handle.createWritable === "function") {
      const writable = await handle.createWritable();
      const writer = writable.getWriter();
      return {
        type: "writable" as const,
        write: (data: Uint8Array) => writer.write(data),
        close: () => writer.close(),
        handle,
        root,
        name: safeName,
      };
    }
    return null;
  } catch { return null; }
}

async function handle(req: Req) {
  const { id, type } = req;
  try {
    const c = await core();

    if (type === "encryptFile") {
      const { file, password, meta, thumbnail } = req;
      const stream = file.stream() as ReadableStream<Uint8Array>;
      const opfs = await createOPFSWriter((file.name || "encrypted") + ".enc");
      const blobParts: Uint8Array[] = [];
      let totalSize = 0;
      for await (const chunk of encryptFileStream({
        core: c, meta, thumbnail, password: utf8Encode(password),
        plaintext: streamIter(stream),
        onProgress: (done, total) => post({ id, type: "progress", done, total, phase: "加密中" }),
      })) {
        totalSize += chunk.length;
        const copy = new Uint8Array(chunk); // copy (chunk is a view into wasm memory)
        if (opfs) {
          opfs.write(copy);
        } else {
          blobParts.push(copy);
        }
      }
      if (opfs) {
        await opfs.close();
        post({ id, type: "done", size: totalSize, opfsName: opfs.name });
      } else {
        const blob = new Blob(blobParts, { type: "application/octet-stream" });
        post({ id, type: "done", blob, size: blob.size });
      }

    } else if (type === "decryptFile") {
      const { file, password } = req;
      const stream = file.stream() as ReadableStream<Uint8Array>;
      const opfs = await createOPFSWriter("decrypted_" + (file.name || "file"));
      const blobParts: Uint8Array[] = [];
      let totalSize = 0;
      let resultMeta: FileMeta | null = null;
      let resultThumb: string | undefined;

      for await (const chunk of decryptFileStream({
        core: c, password: utf8Encode(password), ciphertext: streamIter(stream),
        onProgress: (done, total) => post({ id, type: "progress", done, total, phase: "解密中" }),
      })) {
        totalSize += chunk.length;
        const copy = new Uint8Array(chunk);
        if (opfs) {
          opfs.write(copy);
        } else {
          blobParts.push(copy);
        }
      }

      resultMeta = (decryptFileStream as any).__meta || null;
      resultThumb = (decryptFileStream as any).__thumb ? bytesToBase64((decryptFileStream as any).__thumb) : undefined;

      if (opfs) {
        await opfs.close();
        post({ id, type: "done", size: totalSize, meta: resultMeta, thumbnailBase64: resultThumb, opfsName: opfs.name });
      } else {
        const mime = resultMeta?.mimeType || "application/octet-stream";
        const blob = new Blob(blobParts, { type: mime });
        post({ id, type: "done", blob, size: blob.size, meta: resultMeta, thumbnailBase64: resultThumb });
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
