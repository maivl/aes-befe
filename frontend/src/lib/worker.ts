import type { FileMeta } from "@crypto-core/src/format";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; onProgress?: (p: Progress) => void }>();

export interface Progress { done: number; total: number; phase: string; }
export interface InspectResult { meta: FileMeta; hasThumbnail: boolean; thumbnailBase64?: string; dataOffset: number; }

// showSaveFilePicker support (user-initiated save to disk)
let _filePickerEnabled = false;
export function enableFilePicker() {
  if (typeof (window as any).showSaveFilePicker === "function" && window.isSecureContext) {
    _filePickerEnabled = true;
  }
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../worker/crypto.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", async (e: MessageEvent) => {
      const m = e.data;
      const entry = pending.get(m.id);
      if (!entry) return;
      if (m.type === "progress") {
        entry.onProgress?.({ done: m.done, total: m.total, phase: m.phase });
      } else if (m.type === "done") {
        pending.delete(m.id);
        // If worker wrote to OPFS, open the file from main thread and create URL
        // (worker URLs are not accessible from main thread)
        if (m.opfsName && typeof (navigator as any).storage?.getDirectory === "function") {
          try {
            const root = await (navigator as any).storage.getDirectory();
            const handle = await root.getFileHandle(m.opfsName);
            const file = await handle.getFile();
            const url = URL.createObjectURL(file);
            entry.resolve({ ...m, url });
          } catch {
            // OPFS read failed — resolve without url
            entry.resolve(m);
          }
        } else {
          entry.resolve(m);
        }
      } else if (m.type === "error") {
        pending.delete(m.id);
        entry.reject(new Error(m.message));
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
  encryptFile: (file: File, password: string, meta: FileMeta, thumbnail: Uint8Array | undefined, onProgress?: (p: Progress) => void) =>
    call<{ blob?: Blob; size: number; opfsName?: string }>({ type: "encryptFile", file, password, meta, thumbnail }, onProgress),
  decryptFile: (file: File, password: string, onProgress?: (p: Progress) => void) =>
    call<{ url?: string; blob?: Blob; size: number; meta: FileMeta | null; thumbnailBase64?: string; opfsName?: string }>({ type: "decryptFile", file, password }, onProgress),
  inspectFile: (file: File) => call<InspectResult>({ type: "inspectFile", file }),
  encryptText: (text: string, password: string, note?: string) => call<{ data: string }>({ type: "encryptText", text, password, note }),
  decryptText: (base64: string, password: string) => call<{ text: string; meta: any }>({ type: "decryptText", base64, password }),
};
