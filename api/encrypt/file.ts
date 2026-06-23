// Vercel Edge Function — /api/encrypt/file
import { encryptFileStream, utf8Encode, type FileMeta } from "../../_lib/crypto";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const config = { runtime: "edge" };

async function* bytesGen(bytes: Uint8Array): AsyncGenerator<Uint8Array> { yield bytes; }

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    const form = await req.formData();
    const file = form.get("file") as File;
    const password = String(form.get("password") || "");
    const meta = JSON.parse(String(form.get("meta") || "{}")) as FileMeta;
    if (!file) return new Response(JSON.stringify({ error: "file required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
    if (!password) return new Response(JSON.stringify({ error: "password required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    let thumbnail: Uint8Array | undefined;
    const tf = form.get("thumbnail");
    if (tf instanceof File) thumbnail = new Uint8Array(await tf.arrayBuffer());
    const parts: Uint8Array[] = [];
    for await (const c of encryptFileStream({ meta, thumbnail, password: utf8Encode(password), plaintext: bytesGen(fileBytes) }))
      parts.push(c);
    let total = 0; for (const c of parts) total += c.length;
    const out = new Uint8Array(total); let o = 0; for (const c of parts) { out.set(c, o); o += c.length; }
    const filename = (meta.originalName || "file") + ".enc";
    return new Response(out, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
        "Content-Length": String(total),
        ...CORS,
      },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
  }
}
