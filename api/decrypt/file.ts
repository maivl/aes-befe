import { CORS, json, decryptFileStream, inspectFileStream, utf8Encode, bytesGen, type FileMeta } from "../../crypto";
export const config = { runtime: "edge" };
export default async function(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    const form = await req.formData();
    const file = form.get("file") as File;
    const password = String(form.get("password") || "");
    if (!file) return json({ error: "file required" }, 400);
    if (!password) return json({ error: "password required" }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let meta: FileMeta;
    try { meta = (await inspectFileStream(bytesGen(bytes))).meta; }
    catch { meta = { originalName: "decrypted.bin", originalSize: 0, mimeType: "application/octet-stream", extension: "bin", createdAt: "", encryptedAt: "", note: "" }; }
    const parts: Uint8Array[] = [];
    for await (const c of decryptFileStream({ password: utf8Encode(password), ciphertext: bytesGen(bytes) })) parts.push(c);
    let total = 0; for (const c of parts) total += c.length;
    const out = new Uint8Array(total); let o = 0; for (const c of parts) { out.set(c, o); o += c.length; }
    const filename = meta.originalName || "decrypted.bin";
    return new Response(out, { headers: { "Content-Type": meta.mimeType || "application/octet-stream", "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`, "Content-Length": String(total), ...CORS } });
  } catch (e: any) { return json({ error: e?.message || String(e) }, 400); }
}
