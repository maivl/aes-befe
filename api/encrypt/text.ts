import { CORS, json, encryptTextToBase64, utf8Encode } from "../../crypto";
export const config = { runtime: "edge" };
export default async function(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    const { text, password, note } = await req.json();
    if (typeof text !== "string" || typeof password !== "string") return json({ error: "text and password required" }, 400);
    return json({ data: await encryptTextToBase64(text, utf8Encode(password), note || "") });
  } catch (e: any) { return json({ error: e?.message || String(e) }, 400); }
}
