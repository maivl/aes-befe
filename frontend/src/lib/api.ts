// Backend API client — relative path + ?XTransformPort=3001 (gateway routing).
// On Vercel (static deploy), no backend is available; the app defaults to local
// mode (Zig wasm) and backend calls silently fail (health check reports offline).
import type { FileMeta } from "@crypto-core/src/format";
import type { InspectResult } from "./worker";

const PORT = 3001;
const base = (p: string) => `${p}?XTransformPort=${PORT}`;

export const backendApi = {
  async health() {
    const r = await fetch(base("/api/health"), { signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Error("backend not ok");
    return r.json();
  },
  async encryptText(text: string, password: string, note = "") {
    const r = await fetch(base("/api/encrypt/text"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, password, note }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j;
  },
  async decryptText(data: string, password: string) {
    const r = await fetch(base("/api/decrypt/text"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data, password }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j;
  },
  async inspect(file: File): Promise<InspectResult> {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(base("/api/inspect"), { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j;
  },
  async encryptFile(file: File, password: string, meta: FileMeta, thumbnail: Uint8Array | undefined): Promise<Blob> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("password", password);
    fd.append("meta", JSON.stringify(meta));
    if (thumbnail) fd.append("thumbnail", new Blob([thumbnail], { type: "image/jpeg" }), "thumb.jpg");
    const r = await fetch(base("/api/encrypt/file"), { method: "POST", body: fd });
    if (!r.ok) {
      const j = await r.json().catch(() => ({ error: "encrypt failed" }));
      throw new Error(j.error);
    }
    return r.blob();
  },
  async decryptFile(file: File, password: string): Promise<Blob> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("password", password);
    const r = await fetch(base("/api/decrypt/file"), { method: "POST", body: fd });
    if (!r.ok) {
      const j = await r.json().catch(() => ({ error: "decrypt failed" }));
      throw new Error(j.error);
    }
    return r.blob();
  },
};
