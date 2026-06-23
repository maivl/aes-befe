// Tiny thumbnail generator (canvas JPEG) for embedding into the ENC1 header.
const MAX_DIM = 200, QUALITY = 0.6;
export interface ThumbResult { bytes: Uint8Array; mime: string; width: number; height: number; }

function canvasToBytes(c: HTMLCanvasElement): Uint8Array {
  const u = c.toDataURL("image/jpeg", QUALITY).split(",")[1];
  const bin = atob(u); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function generateThumbnail(file: File): Promise<ThumbResult | null> {
  if (file.type.startsWith("image/")) return genImage(file);
  if (file.type.startsWith("video/")) return genVideo(file);
  return null;
}

function genImage(file: File): Promise<ThumbResult | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const s = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d")!.drawImage(img, 0, 0, w, h);
        resolve({ bytes: canvasToBytes(c), mime: "image/jpeg", width: w, height: h });
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

function genVideo(file: File): Promise<ThumbResult | null> {
  return new Promise((resolve) => {
    const v = document.createElement("video"); v.muted = true; v.preload = "metadata";
    const url = URL.createObjectURL(file); let settled = false;
    const fin = (r: ThumbResult | null) => { if (settled) return; settled = true; URL.revokeObjectURL(url); resolve(r); };
    v.onloadeddata = () => { try { v.currentTime = (v.duration || 1) * 0.25; } catch { fin(null); } };
    v.onseeked = () => {
      try {
        const s = Math.min(1, MAX_DIM / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.max(1, Math.round(v.videoWidth * s)), h = Math.max(1, Math.round(v.videoHeight * s));
        const c = document.createElement("canvas"); c.width = w; c.height = h;
        c.getContext("2d")!.drawImage(v, 0, 0, w, h);
        fin({ bytes: canvasToBytes(c), mime: "image/jpeg", width: w, height: h });
      } catch { fin(null); }
    };
    v.onerror = () => fin(null);
    setTimeout(() => fin(null), 5000);
    v.src = url;
  });
}
