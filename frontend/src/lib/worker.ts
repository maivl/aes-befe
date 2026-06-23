// Singleton WebWorker client wrapping the crypto worker. Each call returns a
// promise that resolves with the result and reports progress via a callback.
import type { FileMeta } from "@crypto-core";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (v: any) => void; reject: (e: any) => void; onProgress?: (p: Progress) => void }
>();

export interface Progress {
  done: number;
  total: number;
  phase: string;
}

export interface InspectResult {
  meta: FileMeta;
  hasThumbnail: boolean;
  thumbnailBase64?: string;
  dataOffset: number;
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../worker/crypto.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (e: MessageEvent) => {
      const msg = e.data;
      const entry = pending.get(msg.id);
      if (!entry) return;
      if (msg.type === "progress") {
        entry.onProgress?.({ done: msg.done, total: msg.total, phase: msg.phase });
      } else if (msg.type === "done") {
        pending.delete(msg.id);
        entry.resolve(msg);
      } else if (msg.type === "error") {
        pending.delete(msg.id);
        entry.reject(new Error(msg.message));
      }
    });
    worker.addEventListener("error", (e) => {
      // reject all pending on fatal worker error
      for (const [id, entry] of pending) {
        entry.reject(new Error(e.message || "Worker error"));
        pending.delete(id);
      }
    });
  }
  return worker;
}

function call<T = any>(req: any, onProgress?: (p: Progress) => void): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    getWorker().postMessage({ id, ...req });
  });
}

export const workerApi = {
  encryptFile: (
    file: File,
    password: string,
    meta: FileMeta,
    thumbnail: Uint8Array | undefined,
    onProgress?: (p: Progress) => void
  ) => call<{ blob: Blob; size: number }>({ type: "encryptFile", file, password, meta, thumbnail }, onProgress),
  decryptFile: (file: File, password: string, onProgress?: (p: Progress) => void) =>
    call<{ blob: Blob; size: number; meta: FileMeta | null; thumbnailBase64?: string }>({ type: "decryptFile", file, password }, onProgress),
  inspectFile: (file: File) => call<InspectResult>({ type: "inspectFile", file }),
  encryptText: (text: string, password: string, note?: string) =>
    call<{ data: string }>({ type: "encryptText", text, password, note }),
  decryptText: (base64: string, password: string) =>
    call<{ text: string; meta: any }>({ type: "decryptText", base64, password }),
};
