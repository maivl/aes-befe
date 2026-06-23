// Vercel serverless — /api/inspect (免密 header reading)
import { inspectFileStream, bytesToBase64 } from "../../crypto-core/src/format";

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
    if (!file) return new Response(JSON.stringify({ error: "file required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { meta, thumbnail, dataOffset } = await inspectFileStream(bytesGen(bytes));
    const hasThumb = !!thumbnail && thumbnail.length > 0;
    return new Response(JSON.stringify({
      meta, hasThumbnail: hasThumb,
      thumbnailBase64: hasThumb ? bytesToBase64(thumbnail!) : undefined,
      dataOffset,
    }), { headers: { "Content-Type": "application/json", ...CORS } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
  }
}
