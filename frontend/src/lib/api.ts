// Backend service API client. All requests use a RELATIVE path + the gateway
// query ?XTransformPort=3001 (never write the host/port in the URL).
import type { FileMeta } from "@crypto-core";
import type { InspectResult } from "./worker";

const PORT = 3001;
const base = (path: string) => `${path}?XTransformPort=${PORT}`;

export interface BackendMeta extends FileMeta {}

export const backendApi = {
  async health() {
    const r = await fetch(base("/api/health"));
    return r.json();
  },

  async encryptText(text: string, password: string, note = ""): Promise<{ data: string }> {
    const r = await fetch(base("/api/encrypt/text"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, password, note }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "encrypt failed");
    return j;
  },

  async decryptText(data: string, password: string): Promise<{ text: string; meta: any }> {
    const r = await fetch(base("/api/decrypt/text"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data, password }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "decrypt failed");
    return j;
  },

  async inspect(file: File): Promise<InspectResult> {
    const fd = new FormData();
    fd.append("file", file);
    const r = await fetch(base("/api/inspect"), { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "inspect failed");
    return j;
  },

  async encryptFile(
    file: File,
    password: string,
    meta: FileMeta,
    thumbnail: Uint8Array | undefined
  ): Promise<Blob> {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("password", password);
    fd.append("meta", JSON.stringify(meta));
    if (thumbnail) {
      fd.append("thumbnail", new Blob([thumbnail], { type: "image/jpeg" }), "thumb.jpg");
    }
    const r = await fetch(base("/api/encrypt/file"), { method: "POST", body: fd });
    if (!r.ok) {
      const j = await r.json().catch(() => ({ error: "encrypt failed" }));
      throw new Error(j.error || "encrypt failed");
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
      throw new Error(j.error || "decrypt failed");
    }
    return r.blob();
  },
};
