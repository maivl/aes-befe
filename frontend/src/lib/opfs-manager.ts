// lib/opfs-manager.ts — List, download, delete OPFS files.
// OPFS files persist until explicitly deleted. This module provides utilities
// for managing them (settings dialog shows the list).

export interface OPFSFile {
  name: string;
  size: number;
  lastModified: number;
}

export function isOPFSAvailable(): boolean {
  return typeof (navigator as any).storage?.getDirectory === "function";
}

/** List all files in OPFS root. */
export async function listOPFSFiles(): Promise<OPFSFile[]> {
  if (!isOPFSAvailable()) return [];
  const root = await (navigator as any).storage.getDirectory();
  const files: OPFSFile[] = [];
  // @ts-ignore — for await works on async dir handles
  for await (const [name, handle] of root.entries()) {
    if (handle.kind === "file") {
      try {
        const file = await handle.getFile();
        files.push({ name, size: file.size, lastModified: file.lastModified });
      } catch {}
    }
  }
  return files.sort((a, b) => b.lastModified - a.lastModified);
}

/** Get a File from OPFS by name. */
export async function getOPFSFile(name: string): Promise<File | null> {
  if (!isOPFSAvailable()) return null;
  const root = await (navigator as any).storage.getDirectory();
  try {
    const handle = await root.getFileHandle(name);
    return await handle.getFile();
  } catch { return null; }
}

/** Delete a file from OPFS by name. */
export async function deleteOPFSFile(name: string): Promise<void> {
  if (!isOPFSAvailable()) return;
  const root = await (navigator as any).storage.getDirectory();
  try { await root.removeEntry(name); } catch {}
}

/** Delete all files in OPFS. */
export async function clearOPFS(): Promise<void> {
  if (!isOPFSAvailable()) return;
  const root = await (navigator as any).storage.getDirectory();
  // @ts-ignore
  for await (const [name, handle] of root.entries()) {
    try { await root.removeEntry(name, { recursive: handle.kind === "directory" }); } catch {}
  }
}

/** Get total OPFS usage in bytes. */
export async function getOPFSUsage(): Promise<number> {
  if (typeof (navigator as any).storage?.estimate === "function") {
    const est = await (navigator as any).storage.estimate();
    return est.usage || 0;
  }
  return 0;
}
