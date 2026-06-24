// lib/share.ts — Share/Download helper.
// IMPORTANT: navigator.share MUST be called synchronously within a user gesture.
// Callers should pre-fetch the File object BEFORE the click handler, then pass
// it to shareFile() which is synchronous.

/**
 * Share a File synchronously (must be called in click handler).
 * Uses navigator.share({files}) when available, falls back to download.
 */
export function shareFile(file: File): void {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    navigator.share({ files: [file] }).catch((e: any) => {
      if (e.name === "AbortError") return;
      downloadFile(file);
    });
  } else {
    downloadFile(file);
  }
}

/** Download a file (fallback for share). */
export function downloadFile(file: File | Blob, filename?: string): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || (file instanceof File ? file.name : "download");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Share text. Falls back to clipboard. */
export function shareText(text: string): void {
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    try { navigator.clipboard.writeText(text); } catch {}
  }
}
