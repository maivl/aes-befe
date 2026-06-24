// lib/stream-decrypt.ts — Main-thread streaming decrypt for large files.
// Avoids WebWorker postMessage overhead and double memory (worker + main).
// Writes decrypted chunks directly to OPFS (or Blob) without intermediate copies.
//
// iOS Safari OOM fix: the worker-based approach copied every chunk via
// postMessage (structured clone), doubling memory. This main-thread approach
// writes each decrypted chunk directly to OPFS, keeping peak memory at ~4MB
// (one GCM chunk = 4MB input + 4MB output in wasm heap, reset between chunks).

import { getZigCore } from "@crypto-core/src/zig-loader-web";
import {
  decryptFileStream,
  utf8Encode,
  utf8Decode,
  bytesToBase64,
  type FileMeta,
} from "@crypto-core/src/format";

export interface DecryptResult {
  url: string;           // OPFS or Blob URL for preview/download
  size: number;          // total decrypted size
  meta: FileMeta | null; // file metadata from header
  thumbnailBase64?: string;
  cleanup: () => Promise<void>;
}

function isOPFSAvailable(): boolean {
  return typeof (navigator as any).storage?.getDirectory === "function";
}

/**
 * Stream-decrypt a file on the main thread, writing to OPFS.
 * Peak memory: ~4MB (one GCM chunk in wasm heap, reset between chunks).
 * No WebWorker → no postMessage copy → no double memory.
 */
export async function streamDecryptFile(
  file: File,
  password: string,
  onProgress?: (done: number, total: number) => void,
): Promise<DecryptResult> {
  const core = await getZigCore();
  const stream = file.stream() as ReadableStream<Uint8Array>;
  const reader = stream.getReader();

  // --- Parse header by reading just enough bytes ---
  let buf = new Uint8Array(0);
  const readMore = async (need: number) => {
    while (buf.length < need) {
      const r = await reader.read();
      if (r.done) break;
      const merged = new Uint8Array(buf.length + r.value.length);
      merged.set(buf, 0);
      merged.set(r.value, buf.length);
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

  // --- Set up output: OPFS file or in-memory Blob ---
  const useOPFS = isOPFSAvailable();
  let opfsRoot: any = null;
  let opfsFileHandle: any = null;
  let opfsWriter: WritableStreamDefaultWriter<Uint8Array> | null = null;
  const blobParts: Uint8Array[] = [];
  let totalSize = 0;

  if (useOPFS) {
    try {
      opfsRoot = await (navigator as any).storage.getDirectory();
      const safeName = (meta.originalName || "decrypted").replace(/[^a-zA-Z0-9._-]/g, "_");
      opfsFileHandle = await opfsRoot.getFileHandle(safeName, { create: true });
      const writable = await opfsFileHandle.createWritable();
      opfsWriter = writable.getWriter();
    } catch {
      opfsWriter = null; // fall back to blob
    }
  }

  // --- Combined ciphertext iterable: remaining buf + rest of stream ---
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

  // --- Decrypt chunk by chunk, write each to OPFS/Blob immediately ---
  try {
    for await (const chunk of decryptFileStream({
      core,
      password: utf8Encode(password),
      ciphertext: ciphertextIter,
      onProgress: (done, total) => onProgress?.(done, total),
    })) {
      totalSize += chunk.length;
      if (opfsWriter) {
        await opfsWriter.write(chunk);
      } else {
        blobParts.push(new Uint8Array(chunk)); // copy (chunk is a view into wasm memory)
      }
    }
  } catch (e) {
    if (opfsWriter) { try { await opfsWriter.abort(); } catch {} }
    throw e;
  }

  // --- Finalize: close OPFS or create Blob, return URL ---
  let url: string;
  const cleanup = async () => {
    URL.revokeObjectURL(url);
    if (opfsRoot && opfsFileHandle) {
      try { await opfsRoot.removeEntry(opfsFileHandle.name); } catch {}
    }
  };

  if (opfsWriter) {
    await opfsWriter.close();
    const file2 = await opfsFileHandle.getFile();
    url = URL.createObjectURL(file2);
  } else {
    const blob = new Blob(blobParts, { type: meta.mimeType || "application/octet-stream" });
    url = URL.createObjectURL(blob);
  }

  return { url, size: totalSize, meta, thumbnailBase64, cleanup };
}
