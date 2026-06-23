import { CORS, json, inspectFileStream, bytesToBase64, bytesGen } from "../crypto";
export const config = { runtime: "edge" };
export default async function(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    const form = await req.formData();
    const file = form.get("file") as File;
    if (!file) return json({ error: "file required" }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { meta, thumbnail, dataOffset } = await inspectFileStream(bytesGen(bytes));
    const hasThumb = !!thumbnail && thumbnail.length > 0;
    return json({ meta, hasThumbnail: hasThumb, thumbnailBase64: hasThumb ? bytesToBase64(thumbnail!) : undefined, dataOffset });
  } catch (e: any) { return json({ error: e?.message || String(e) }, 400); }
}
