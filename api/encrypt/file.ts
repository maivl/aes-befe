import { CORS, json, encryptFileStream, utf8Encode, bytesGen, type FileMeta } from "../../crypto";
export const config = { runtime: "edge" };
export default async function(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    const form = await req.formData();
    const file = form.get("file") as File;
    const password = String(form.get("password") || "");
    const meta = JSON.parse(String(form.get("meta") || "{}")) as FileMeta;
    if (!file) return json({ error: "file required" }, 400);
    if (!password) return json({ error: "password required" }, 400);
    const fileBytes = new Uint8Array(await file.arrayBuffer());
    let thumbnail: Uint8Array | undefined;
    const tf = form.get("thumbnail");
    if (tf instanceof File) thumbnail = new Uint8Array(await tf.arrayBuffer());
    const parts: Uint8Array[] = [];
    for await (const c of encryptFileStream({ meta, thumbnail, password: utf8Encode(password), plaintext: bytesGen(fileBytes) })) parts.push(c);
    let total = 0; for (const c of parts) total += c.length;
    const out = new Uint8Array(total); let o = 0; for (const c of parts) { out.set(c, o); o += c.length; }
    const filename = (meta.originalName || "file") + ".enc";
    return new Response(out, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`, "Content-Length": String(total), ...CORS } });
  } catch (e: any) { return json({ error: e?.message || String(e) }, 400); }
}
