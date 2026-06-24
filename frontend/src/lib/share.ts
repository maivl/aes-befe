// lib/share.ts — Share/Download helper. Uses Web Share API with files when
// available (iOS Safari, Android Chrome), falls back to download.

/**
 * Share a file via Web Share API (navigator.share with files).
 * Falls back to download if not supported.
 */
export async function shareOrDownload(file: Blob | File, filename: string): Promise<void> {
  // Ensure it's a File (navigator.share requires File)
  const shareFile = file instanceof File ? file : new File([file], filename, { type: file.type || "application/octet-stream" });

  if (navigator.canShare && navigator.canShare({ files: [shareFile] })) {
    try {
      await navigator.share({ files: [shareFile] });
      return;
    } catch (e: any) {
      if (e.name === "AbortError") return; // user cancelled
      // Fall through to download
    }
  }
  // Fallback: download
  const url = URL.createObjectURL(shareFile);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Share text via Web Share API. Falls back to clipboard.
 */
export async function shareText(text: string): Promise<void> {
  if (navigator.share) {
    try { await navigator.share({ text }); return; } catch (e: any) { if (e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(text); } catch {}
}
