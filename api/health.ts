import { CORE_INFO, CORS, json } from "../crypto";
export const config = { runtime: "edge" };
export default async function(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  return json({ ok: true, core: CORE_INFO, backend: "vercel-edge" });
}
