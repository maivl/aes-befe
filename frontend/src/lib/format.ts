export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(2)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}
export function formatDate(iso: string): string {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("zh-CN", { hour12: false }); } catch { return iso; }
}
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function guessMime(file: File): string {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const m: Record<string, string> = { txt: "text/plain", json: "application/json", pdf: "application/pdf", zip: "application/zip", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", bin: "application/octet-stream" };
  return m[ext] || "application/octet-stream";
}
export function getExtension(name: string): string { const i = name.lastIndexOf("."); return i >= 0 ? name.slice(i + 1).toLowerCase() : ""; }
