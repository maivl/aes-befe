// Thumbnail generation for the encrypted-file header. Generates a tiny JPEG from
// image files (and a video poster frame when possible) using canvas, fully in the
// browser. The thumbnail is embedded into the ENC1 header so encrypted files can
// be previewed WITHOUT decryption.

const MAX_DIM = 200; // max thumbnail dimension
const QUALITY = 0.6;

function canvasToFileThumb(canvas: HTMLCanvasElement): Uint8Array {
  const dataUrl = canvas.toDataURL("image/jpeg", QUALITY);
  const base64 = dataUrl.split(",")[1];
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export interface ThumbResult {
  bytes: Uint8Array;
  mime: string;
  width: number;
  height: number;
}

export async function generateThumbnail(file: File): Promise<ThumbResult | null> {
  const type = file.type;
  if (type.startsWith("image/")) {
    return generateImageThumb(file);
  }
  if (type.startsWith("video/")) {
    return generateVideoThumb(file);
  }
  return null;
}

function generateImageThumb(file: File): Promise<ThumbResult | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ bytes: canvasToFileThumb(canvas), mime: "image/jpeg", width: w, height: h });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = URL.createObjectURL(file);
  });
}

function generateVideoThumb(file: File): Promise<ThumbResult | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "metadata";
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (r: ThumbResult | null) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(r);
    };
    video.onloadeddata = () => {
      try {
        // seek to 25% for a representative frame
        video.currentTime = Math.min(video.duration || 1, 1) * 0.25;
      } catch {
        finish(null);
      }
    };
    video.onseeked = () => {
      try {
        const scale = Math.min(1, MAX_DIM / Math.max(video.videoWidth, video.videoHeight));
        const w = Math.max(1, Math.round(video.videoWidth * scale));
        const h = Math.max(1, Math.round(video.videoHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return finish(null);
        ctx.drawImage(video, 0, 0, w, h);
        finish({ bytes: canvasToFileThumb(canvas), mime: "image/jpeg", width: w, height: h });
      } catch {
        finish(null);
      }
    };
    video.onerror = () => finish(null);
    setTimeout(() => finish(null), 5000);
    video.src = url;
  });
}
