// Bun backend crypto service (port 3001).
// Loads the Zig-compiled libcryptocore.so via bun:ffi and reuses the shared
// isomorphic format layer. Reached through the gateway via relative path +
// ?XTransformPort=3001.
import { getZigCore } from "../../crypto-core/src/zig-loader-native";
import {
  encryptFileStream,
  decryptFileStream,
  inspectFileStream,
  encryptTextToBase64,
  decryptTextFromBase64,
  bytesToBase64,
  utf8Encode,
  type FileMeta,
} from "../../crypto-core/src/format";
import { CORE_INFO } from "../../crypto-core/src/index";

const core = getZigCore();
const PORT = 3001;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra } });
}

function genToStream(gen: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) controller.close(); else controller.enqueue(value);
      } catch (e: any) {
        controller.error(e);
      }
    },
    cancel() { gen.return(undefined as any); },
  });
}

async function fileToBytes(f: File | null): Promise<Uint8Array> {
  if (!f) throw new Error("Missing file field");
  return new Uint8Array(await f.arrayBuffer());
}
async function* bytesGen(bytes: Uint8Array): AsyncGenerator<Uint8Array> { yield bytes; }

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    try {
      if (path === "/api/health" && req.method === "GET")
        return json({ ok: true, core: CORE_INFO, port: PORT });

      if (path === "/api/encrypt/text" && req.method === "POST") {
        const { text, password, note } = await req.json();
        if (typeof text !== "string" || typeof password !== "string") return json({ error: "text and password required" }, 400);
        return json({ data: await encryptTextToBase64(core, text, utf8Encode(password), note || "") });
      }
      if (path === "/api/decrypt/text" && req.method === "POST") {
        const { data, password } = await req.json();
        if (typeof data !== "string" || typeof password !== "string") return json({ error: "data and password required" }, 400);
        const { text, meta } = await decryptTextFromBase64(core, data, utf8Encode(password));
        return json({ text, meta });
      }
      if (path === "/api/inspect" && req.method === "POST") {
        const form = await req.formData();
        const bytes = await fileToBytes(form.get("file") as File);
        const { meta, thumbnail, dataOffset } = await inspectFileStream(bytesGen(bytes));
        const hasThumb = !!thumbnail && thumbnail.length > 0;
        return json({ meta, hasThumbnail: hasThumb, thumbnailBase64: hasThumb ? bytesToBase64(thumbnail!) : undefined, dataOffset });
      }
      if (path === "/api/encrypt/file" && req.method === "POST") {
        const form = await req.formData();
        const file = form.get("file") as File;
        const password = String(form.get("password") || "");
        const meta = JSON.parse(String(form.get("meta") || "{}")) as FileMeta;
        if (!file) return json({ error: "file required" }, 400);
        if (!password) return json({ error: "password required" }, 400);
        const fileBytes = await fileToBytes(file);
        let thumbnail: Uint8Array | undefined;
        const tf = form.get("thumbnail");
        if (tf instanceof File) thumbnail = await fileToBytes(tf);
        // Buffer the encrypted output so errors surface as a clean 400.
        const parts: Uint8Array[] = [];
        for await (const c of encryptFileStream({ core, meta, thumbnail, password: utf8Encode(password), plaintext: bytesGen(fileBytes) })) parts.push(c);
        let total = 0; for (const c of parts) total += c.length;
        const out = new Uint8Array(total); let o = 0; for (const c of parts) { out.set(c, o); o += c.length; }
        const filename = (meta.originalName || "file") + ".enc";
        return new Response(out, { status: 200, headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`, "Content-Length": String(total), ...CORS } });
      }
      if (path === "/api/decrypt/file" && req.method === "POST") {
        const form = await req.formData();
        const file = form.get("file") as File;
        const password = String(form.get("password") || "");
        if (!file) return json({ error: "file required" }, 400);
        if (!password) return json({ error: "password required" }, 400);
        const bytes = await fileToBytes(file);
        let meta: FileMeta;
        try { meta = (await inspectFileStream(bytesGen(bytes))).meta; }
        catch { meta = { originalName: "decrypted.bin", originalSize: 0, mimeType: "application/octet-stream", extension: "bin", createdAt: "", encryptedAt: "", note: "" }; }
        const parts: Uint8Array[] = [];
        for await (const c of decryptFileStream({ core, password: utf8Encode(password), ciphertext: bytesGen(bytes) })) parts.push(c);
        let total = 0; for (const p of parts) total += p.length;
        const out = new Uint8Array(total); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
        const filename = meta.originalName || "decrypted.bin";
        return new Response(out, { status: 200, headers: { "Content-Type": meta.mimeType || "application/octet-stream", "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`, "Content-Length": String(total), ...CORS } });
      }
      return json({ error: "Not found", path }, 404);
    } catch (e: any) {
      const msg = e?.message || String(e);
      const status = /password|padding|PKCS7|magic|version|encrypt/i.test(msg) ? 400 : 500;
      return json({ error: msg }, status);
    }
  },
});

console.log(`🔒 Crypto backend (Zig .so via bun:ffi) on http://localhost:${PORT}`);
console.log(`   ${CORE_INFO.algorithm} | ${CORE_INFO.kdf}`);
