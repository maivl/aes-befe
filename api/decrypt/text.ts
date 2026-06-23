import { CORS, json, decryptTextFromBase64, utf8Encode } from "../../crypto";
export const config = { runtime: "edge" };
export default async function(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    const { data, password } = await req.json();
    if (typeof data !== "string" || typeof password !== "string") return json({ error: "data and password required" }, 400);
    const { text, meta } = await decryptTextFromBase64(data, utf8Encode(password));
    return json({ text, meta });
  } catch (e: any) { return json({ error: e?.message || String(e) }, 400); }
}
