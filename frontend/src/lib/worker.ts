import type { FileMeta } from "@crypto-core/src/format";

let worker: Worker | null = null;
let nextId = 1;

interface PendingCall {
  resolve: (v: any) => void;
  reject: (e: any) => void;
  onProgress?: (p: Progress) => void;
  // Streaming: write chunks to OPFS or collect as Blob
  opfsWritable: WritableStreamDefaultWriter<Uint8Array> | null;
  opfsRoot: any; // FileSystemDirectoryHandle for cleanup
  opfsFilename: string;
  blobChunks: Uint8Array[];
  totalSize: number;
}

const pending = new Map<number, PendingCall>();

export interface Progress { done: number; total: number; phase: string; }
export interface InspectResult { meta: FileMeta; hasThumbnail: boolean; thumbnailBase64?: string; dataOffset: number; }

// File System Access API for showSaveFilePicker (user-initiated save to disk)
let _filePickerEnabled = false;
export function enableFilePicker() {
  if (typeof (window as any).showSaveFilePicker === "function" && window.isSecureContext) {
    _filePickerEnabled = true;
  }
}

function isOPFSAvailable(): boolean {
  return typeof (navigator as any).storage?.getDirectory === "function";
}

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
        const data = new Uint8Array(m.data);
        entry.totalSize += data.length;
        if (entry.opfsWritable) {
          // Write to OPFS — frees memory immediately
          entry.opfsWritable.write(data);
        } else {
          // Fallback: collect in memory (Blob)
          entry.blobChunks.push(data);
        }
      } else if (m.type === "done") {
        pending.delete(m.id);
        if (entry.opfsWritable) {
          // Close OPFS stream, get URL from the file
          entry.opfsWritable.close().then(async () => {
            try {
              const fileHandle = await entry.opfsRoot.getFileHandle(entry.opfsFilename);
              const file = await fileHandle.getFile();
              const url = URL.createObjectURL(file);
              entry.resolve({
                blob: null, size: entry.totalSize, url,
                meta: m.meta, thumbnailBase64: m.thumbnailBase64, streamed: true,
              });
            } catch (err) {
              entry.reject(err);
            }
          });
        } else if (m.data !== undefined || m.text !== undefined) {
          // Text encrypt/decrypt
          entry.resolve(m);
        } else {
          // File encrypt/decrypt Blob fallback
          const blob = new Blob(entry.blobChunks, { type: "application/octet-stream" });
          entry.resolve({ blob, size: blob.size, meta: m.meta, thumbnailBase64: m.thumbnailBase64 });
        }
      } else if (m.type === "error") {
        pending.delete(m.id);
        if (entry.opfsWritable) { try { entry.opfsWritable.abort(); } catch {} }
        entry.reject(new Error(m.message));
      }
    });
  }
  return worker;
}

function call<T = any>(req: any, onProgress?: (p: Progress) => void): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress, opfsWritable: null, opfsRoot: null, opfsFilename: "", blobChunks: [], totalSize: 0 });
    getWorker().postMessage({ id, ...req });
  });
}

/**
 * Streaming file encrypt/decrypt — writes to OPFS to avoid memory accumulation.
 * For encrypt: always use Blob (user needs to download the .enc file).
 * For decrypt: use OPFS if available (especially for images/videos), Blob fallback.
 */
async function callWithOPFS<T = any>(req: any, opfsFilename: string, onProgress?: (p: Progress) => void): Promise<T> {
  // Only use OPFS for decrypt (encrypt result is downloaded as .enc)
  if (req.type !== "decryptFile" || !isOPFSAvailable()) {
    return call<T>(req, onProgress);
  }
  const id = nextId++;
  return new Promise<T>(async (resolve, reject) => {
    try {
      const root = await (navigator as any).storage.getDirectory();
      const safeName = opfsFilename.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileHandle = await root.getFileHandle(safeName, { create: true });
      const writable = await fileHandle.createWritable();
      pending.set(id, {
        resolve, reject, onProgress,
        opfsWritable: writable.getWriter(), opfsRoot: root, opfsFilename: safeName,
        blobChunks: [], totalSize: 0,
      });
      getWorker().postMessage({ id, ...req });
    } catch {
      // OPFS failed — fall back to Blob
      call<T>(req, onProgress).then(resolve, reject);
    }
  });
}

export const workerApi = {
  encryptFile: (file: File, password: string, meta: FileMeta, thumbnail: Uint8Array | undefined, onProgress?: (p: Progress) => void) => {
    return call<{ blob: Blob; size: number; streamed?: boolean }>({ type: "encryptFile", file, password, meta, thumbnail }, onProgress);
  },
  decryptFile: async (file: File, password: string, onProgress?: (p: Progress) => void) => {
    // Get the original filename for OPFS
    let saveFilename = "decrypted";
    try {
      const insp = await workerApi.inspectFile(file);
      saveFilename = insp.meta.originalName || "decrypted";
    } catch {}
    return callWithOPFS<{ blob: Blob | null; size: number; meta: FileMeta | null; thumbnailBase64?: string; streamed?: boolean; url?: string }>(
      { type: "decryptFile", file, password }, saveFilename, onProgress
    );
  },
  inspectFile: (file: File) => call<InspectResult>({ type: "inspectFile", file }),
  encryptText: (text: string, password: string, note?: string) => call<{ data: string }>({ type: "encryptText", text, password, note }),
  decryptText: (base64: string, password: string) => call<{ text: string; meta: any }>({ type: "decryptText", base64, password }),
};
