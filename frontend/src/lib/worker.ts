import type { FileMeta } from "@crypto-core/src/format";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void; onProgress?: (p: Progress) => void }>();

export interface Progress { done: number; total: number; phase: string; }
export interface InspectResult { meta: FileMeta; hasThumbnail: boolean; thumbnailBase64?: string; dataOffset: number; }

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../worker/crypto.worker.ts", import.meta.url), { type: "module" });
    worker.addEventListener("message", (e: MessageEvent) => {
      const m = e.data; const entry = pending.get(m.id);
      if (!entry) return;
      if (m.type === "progress") entry.onProgress?.({ done: m.done, total: m.total, phase: m.phase });
      else if (m.type === "done") { pending.delete(m.id); entry.resolve(m); }
      else if (m.type === "error") { pending.delete(m.id); entry.reject(new Error(m.message)); }
    });
  }
  return worker;
}
function call<T = any>(req: any, onProgress?: (p: Progress) => void): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => { pending.set(id, { resolve, reject, onProgress }); getWorker().postMessage({ id, ...req }); });
}

export const workerApi = {
  encryptFile: (file: File, password: string, meta: FileMeta, thumbnail: Uint8Array | undefined, onProgress?: (p: Progress) => void) =>
    call<{ blob: Blob; size: number }>({ type: "encryptFile", file, password, meta, thumbnail }, onProgress),
  decryptFile: (file: File, password: string, onProgress?: (p: Progress) => void) =>
    call<{ blob: Blob; size: number; meta: FileMeta | null; thumbnailBase64?: string }>({ type: "decryptFile", file, password }, onProgress),
  inspectFile: (file: File) => call<InspectResult>({ type: "inspectFile", file }),
  encryptText: (text: string, password: string, note?: string) => call<{ data: string }>({ type: "encryptText", text, password, note }),
  decryptText: (base64: string, password: string) => call<{ text: string; meta: any }>({ type: "decryptText", base64, password }),
};
