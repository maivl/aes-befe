// Vercel Edge Function — /api/encrypt/text
import { encryptTextToBase64, utf8Encode } from "../../_lib/crypto";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    const { text, password, note } = await req.json();
    if (typeof text !== "string" || typeof password !== "string")
      return new Response(JSON.stringify({ error: "text and password required" }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
    const data = await encryptTextToBase64(text, utf8Encode(password), note || "");
    return new Response(JSON.stringify({ data }), { headers: { "Content-Type": "application/json", ...CORS } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), { status: 400, headers: { "Content-Type": "application/json", ...CORS } });
  }
}
