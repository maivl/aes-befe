import type { FileMeta } from "@crypto-core/src/format";

let worker: Worker | null = null;
let nextId = 1;

interface PendingCall {
  resolve: (v: any) => void;
  reject: (e: any) => void;
  onProgress?: (p: Progress) => void;
  // Streaming file write support
  writeFile?: WritableStreamDefaultWriter<Uint8Array> | null;
  blobChunks: Uint8Array[];
  saveFilename?: string;
}

const pending = new Map<number, PendingCall>();

export interface Progress { done: number; total: number; phase: string; }
export interface InspectResult { meta: FileMeta; hasThumbnail: boolean; thumbnailBase64?: string; dataOffset: number; }

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../worker/crypto.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (e: MessageEvent) => {
      const m = e.data;
      const entry = pending.get(m.id);
      if (!entry) return;
      if (m.type === "progress") {
        entry.onProgress?.({ done: m.done, total: m.total, phase: m.phase });
      } else if (m.type === "chunk") {
        // Streaming: write chunk to file or collect for blob fallback
        const data = new Uint8Array(m.data);
        if (entry.writeFile) {
          entry.writeFile.write(data);
        } else {
          entry.blobChunks.push(data);
        }
      } else if (m.type === "done") {
        pending.delete(m.id);
        if (entry.writeFile) {
          // Streaming file write — file already saved to disk
          entry.writeFile.close().then(() => {
            entry.resolve({ size: m.size, meta: m.meta, thumbnailBase64: m.thumbnailBase64, streamed: true });
          });
        } else if (m.data !== undefined || m.text !== undefined) {
          // Text encrypt/decrypt — pass through directly
          entry.resolve(m);
        } else {
          // File encrypt/decrypt blob fallback — collect chunks into Blob
          const blob = new Blob(entry.blobChunks, { type: "application/octet-stream" });
          entry.resolve({ blob, size: blob.size, meta: m.meta, thumbnailBase64: m.thumbnailBase64 });
        }
      } else if (m.type === "error") {
        pending.delete(m.id);
        if (entry.writeFile) { try { entry.writeFile.abort(); } catch {} }
        entry.reject(new Error(m.message));
      }
    });
  }
  return worker;
}

/**
 * Try to use File System Access API (showSaveFilePicker) for streaming to disk.
 * Falls back to Blob (in-memory) if not supported.
 */
// File System Access API support — disabled by default. Can be enabled when
// showSaveFilePicker is called synchronously from a user gesture (click handler).
// Currently we use Blob fallback which still streams chunks from the worker
// (worker memory is freed between chunks via wasm heap reset).
let _filePickerEnabled = false;

export function enableFilePicker() {
  if (typeof (window as any).showSaveFilePicker === "function" && window.isSecureContext) {
    _filePickerEnabled = true;
  }
}

async function getStreamWriter(filename: string): Promise<WritableStreamDefaultWriter<Uint8Array> | null> {
  if (!_filePickerEnabled) return null;
  try {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: filename,
      types: [{ description: "File", accept: { "application/octet-stream": [".enc", ".bin", ""] } }],
    });
    const writable = await handle.createWritable();
    return writable.getWriter();
  } catch (e: any) {
    if (e.name === "AbortError") throw e;
    _filePickerEnabled = false;
    return null;
  }
}

function call<T = any>(req: any, onProgress?: (p: Progress) => void): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress, writeFile: null, blobChunks: [], saveFilename: req.saveFilename });
    getWorker().postMessage({ id, ...req });
  });
}

/**
 * Streaming file encrypt/decrypt — writes chunks to file via File System Access API
 * if available, otherwise collects into a Blob.
 */
async function callStreaming<T = any>(req: any, filename: string, onProgress?: (p: Progress) => void): Promise<T> {
  const id = nextId++;
  return new Promise<T>(async (resolve, reject) => {
    let writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    try {
      writer = await getStreamWriter(filename);
    } catch (e: any) {
      reject(e);
      return;
    }
    pending.set(id, { resolve, reject, onProgress, writeFile: writer, blobChunks: [], saveFilename: filename });
    getWorker().postMessage({ id, ...req });
  });
}

export const workerApi = {
  encryptFile: (file: File, password: string, meta: FileMeta, thumbnail: Uint8Array | undefined, onProgress?: (p: Progress) => void) => {
    return call<{ blob: Blob; size: number; streamed?: boolean }>({ type: "encryptFile", file, password, meta, thumbnail }, onProgress);
  },
  decryptFile: async (file: File, password: string, onProgress?: (p: Progress) => void) => {
    return call<{ blob: Blob; size: number; meta: FileMeta | null; thumbnailBase64?: string; streamed?: boolean }>({ type: "decryptFile", file, password }, onProgress);
  },
  inspectFile: (file: File) => call<InspectResult>({ type: "inspectFile", file }),
  encryptText: (text: string, password: string, note?: string) => call<{ data: string }>({ type: "encryptText", text, password, note }),
  decryptText: (base64: string, password: string) => call<{ text: string; meta: any }>({ type: "decryptText", base64, password }),
};
