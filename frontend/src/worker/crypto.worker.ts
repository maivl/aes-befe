// WebWorker: loads the Zig-compiled crypto.wasm and runs all crypto locally,
// off the main thread. Plaintext never leaves the browser in local mode.
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
function core() {
  if (!coreReady) coreReady = getZigCore();
  return coreReady;
}

type Req =
  | { id: number; type: "encryptFile"; file: File; password: string; meta: FileMeta; thumbnail?: Uint8Array }
  | { id: number; type: "decryptFile"; file: File; password: string }
  | { id: number; type: "inspectFile"; file: File }
  | { id: number; type: "encryptText"; text: string; password: string; note?: string }
  | { id: number; type: "decryptText"; base64: string; password: string };

function post(msg: any) { (self as any).postMessage(msg); }

function bytesIter(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return { [Symbol.asyncIterator]() {
    let sent = false;
    return { async next() { if (sent) return { value: undefined, done: true as const }; sent = true; return { value: bytes, done: false as const }; } };
  } };
}

function countingIter(stream: ReadableStream<Uint8Array>, id: number, total: number, phase: string): AsyncIterable<Uint8Array> {
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
      const parts: Uint8Array[] = [];
      for await (const chunk of encryptFileStream({ core: c, meta, thumbnail, password: utf8Encode(password), plaintext: countingIter(stream, id, file.size, "加密中") })) {
        parts.push(chunk);
      }
      const blob = new Blob(parts, { type: "application/octet-stream" });
      post({ id, type: "done", blob, size: blob.size });
    } else if (type === "decryptFile") {
      const { file, password } = req;
      const bytes = new Uint8Array(await file.arrayBuffer());
      let meta: FileMeta | null = null;
      let thumbnailBase64: string | undefined;
      try {
        const insp = await inspectFileStream(bytesIter(bytes));
        meta = insp.meta;
        if (insp.thumbnail && insp.thumbnail.length) thumbnailBase64 = bytesToBase64(insp.thumbnail);
      } catch {}
      post({ id, type: "progress", done: 0, total: bytes.length, phase: "解密中" });
      const parts: Uint8Array[] = [];
      for await (const chunk of decryptFileStream({ core: c, password: utf8Encode(password), ciphertext: bytesIter(bytes) })) {
        parts.push(chunk);
      }
      const blob = new Blob(parts, { type: meta?.mimeType || "application/octet-stream" });
      post({ id, type: "done", blob, size: blob.size, meta, thumbnailBase64 });
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
  } catch (e: any) {
    post({ id, type: "error", message: e?.message || String(e) });
  }
}

self.addEventListener("message", (e: MessageEvent<Req>) => handle(e.data));
