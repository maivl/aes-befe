// WebWorker running the shared crypto-core for non-blocking streaming encrypt /
// decrypt / inspect. This is the "frontend local encryption" path — plaintext
// never leaves the browser.
import {
  encryptFileStream,
  decryptFileStream,
  inspectFileStream,
  encryptTextToBase64,
  decryptTextFromBase64,
  bytesToBase64,
  type FileMeta,
} from "@crypto-core";

type Req =
  | { id: number; type: "encryptFile"; file: File; password: string; meta: FileMeta; thumbnail?: Uint8Array }
  | { id: number; type: "decryptFile"; file: File; password: string }
  | { id: number; type: "inspectFile"; file: File }
  | { id: number; type: "encryptText"; text: string; password: string; note?: string }
  | { id: number; type: "decryptText"; base64: string; password: string };

function post(msg: any) {
  (self as any).postMessage(msg);
}

/** Single-shot async iterable over a Uint8Array buffer. */
function bytesToIterable(bytes: Uint8Array): AsyncIterable<Uint8Array> {
  return {
    [Symbol.asyncIterator]() {
      let sent = false;
      return {
        async next() {
          if (sent) return { value: undefined, done: true as const };
          sent = true;
          return { value: bytes, done: false as const };
        },
      };
    },
  };
}

/** Wrap a ReadableStream to count consumed bytes and report progress. */
function countingIterable(stream: ReadableStream<Uint8Array>, id: number, total: number, phase: string): AsyncIterable<Uint8Array> {
  const reader = stream.getReader();
  return {
    [Symbol.asyncIterator]() {
      let done = 0;
      return {
        async next() {
          const r = await reader.read();
          if (r.done) return { value: undefined, done: true as const };
          const v = r.value as Uint8Array;
          done += v.length;
          post({ id, type: "progress", done, total, phase });
          return { value: v, done: false as const };
        },
        async return() {
          try { await reader.cancel(); } catch {}
          return { value: undefined, done: true as const };
        },
      };
    },
  };
}

async function readAll(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

async function handle(req: Req) {
  const { id, type } = req;
  try {
    if (type === "encryptFile") {
      const { file, password, meta, thumbnail } = req;
      const stream = file.stream() as ReadableStream<Uint8Array>;
      const plaintext = countingIterable(stream, id, file.size, "加密中");
      const parts: Uint8Array[] = [];
      for await (const chunk of encryptFileStream({ meta, thumbnail, password, plaintext })) {
        parts.push(chunk);
      }
      const blob = new Blob(parts, { type: "application/octet-stream" });
      post({ id, type: "done", blob, size: blob.size });
    } else if (type === "decryptFile") {
      const { file, password } = req;
      const bytes = await readAll(file);
      // inspect first to recover metadata + thumbnail (no password)
      let meta: FileMeta | null = null;
      let thumbnailBase64: string | undefined;
      try {
        const insp = await inspectFileStream(bytesToIterable(bytes));
        meta = insp.meta;
        if (insp.thumbnail && insp.thumbnail.length) thumbnailBase64 = bytesToBase64(insp.thumbnail);
      } catch {}
      post({ id, type: "progress", done: 0, total: bytes.length, phase: "解密中" });
      const parts: Uint8Array[] = [];
      for await (const chunk of decryptFileStream({ password, ciphertext: bytesToIterable(bytes) })) {
        parts.push(chunk);
      }
      const mime = meta?.mimeType || "application/octet-stream";
      const blob = new Blob(parts, { type: mime });
      post({ id, type: "done", blob, size: blob.size, meta, thumbnailBase64 });
    } else if (type === "inspectFile") {
      const bytes = await readAll(req.file);
      const insp = await inspectFileStream(bytesToIterable(bytes));
      post({
        id,
        type: "done",
        meta: insp.meta,
        hasThumbnail: !!insp.thumbnail && insp.thumbnail.length > 0,
        thumbnailBase64: insp.thumbnail && insp.thumbnail.length ? bytesToBase64(insp.thumbnail) : undefined,
        dataOffset: insp.dataOffset,
      });
    } else if (type === "encryptText") {
      const data = await encryptTextToBase64(req.text, req.password, req.note || "");
      post({ id, type: "done", data });
    } else if (type === "decryptText") {
      const { text, meta } = await decryptTextFromBase64(req.base64, req.password);
      post({ id, type: "done", text, meta });
    }
  } catch (e: any) {
    post({ id, type: "error", message: e?.message || String(e) });
  }
}

self.addEventListener("message", (e: MessageEvent<Req>) => {
  handle(e.data);
});
