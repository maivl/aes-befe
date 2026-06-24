// lib/opfs.ts — Origin Private File System (OPFS) for large file preview.
// OPFS allows writing decrypted data to a virtual file system, then creating
// a URL from it WITHOUT holding the entire blob in memory.
// iOS Safari 15.2+ supports OPFS read/write.
// Falls back to Blob URL on older browsers.

/** Check if OPFS is available */
export function isOPFSSupported(): boolean {
  return typeof (navigator as any).storage?.getDirectory === "function";
}

/**
 * Write a stream of Uint8Array chunks to OPFS, return a URL for preview.
 * The file is stored in the browser's private file system (not user-visible).
 * Caller is responsible for revoking the URL and deleting the file when done.
 */
export async function writeToOPFS(
  filename: string,
  chunks: AsyncIterable<Uint8Array> | Uint8Array[]
): Promise<{ url: string; cleanup: () => Promise<void> }> {
  if (!isOPFSSupported()) {
    // Fallback: collect into Blob (memory)
    const parts: Uint8Array[] = [];
    if (Array.isArray(chunks)) parts.push(...chunks);
    else for await (const c of chunks) parts.push(c);
    const blob = new Blob(parts, { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    return { url, cleanup: async () => URL.revokeObjectURL(url) };
  }

  // Use OPFS — write chunks to a file in the private file system
  const root = await (navigator as any).storage.getDirectory();
  const fileHandle = await root.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();

  if (Array.isArray(chunks)) {
    for (const chunk of chunks) await writable.write(chunk);
  } else {
    for await (const chunk of chunks) await writable.write(chunk);
  }
  await writable.close();

  // Get a URL from the OPFS file
  const file = await fileHandle.getFile();
  const url = URL.createObjectURL(file);

  return {
    url,
    cleanup: async () => {
      URL.revokeObjectURL(url);
      try { await root.removeEntry(filename); } catch {}
    },
  };
}

/**
 * Write a single Blob to OPFS and return a URL.
 * Useful for converting an in-memory blob to an OPFS-backed URL
 * (frees the blob from memory after the file is written).
 */
export async function blobToOPFS(
  filename: string,
  blob: Blob
): Promise<{ url: string; cleanup: () => Promise<void> }> {
  if (!isOPFSSupported()) {
    const url = URL.createObjectURL(blob);
    return { url, cleanup: async () => URL.revokeObjectURL(url) };
  }

  const root = await (navigator as any).storage.getDirectory();
  const fileHandle = await root.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();

  const file = await fileHandle.getFile();
  const url = URL.createObjectURL(file);

  return {
    url,
    cleanup: async () => {
      URL.revokeObjectURL(url);
      try { await root.removeEntry(filename); } catch {}
    },
  };
}
