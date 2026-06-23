// Vercel Edge Function — /api/health
import { CORE_INFO } from "../_lib/crypto";

export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  return new Response(JSON.stringify({ ok: true, core: CORE_INFO, backend: "vercel-edge" }), {
    headers: { "Content-Type": "application/json", ...cors },
  });
}
