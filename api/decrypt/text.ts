// Vercel Edge Function — /api/decrypt/text
import { decryptTextFromBase64, utf8Encode } from "../../_lib/crypto";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    const { data, password } = await req.json();
    if (typeof data !== "string" || typeof password !== "string")
      return new Response(JSON.stringify({ error: "data and password required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
    const { text, meta } = await decryptTextFromBase64(data, utf8Encode(password));
    return new Response(JSON.stringify({ text, meta }), { headers: { "Content-Type": "application/json", ...CORS } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
  }
}
