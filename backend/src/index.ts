// Bun backend crypto service (port 3001).
// Reuses the SAME isomorphic crypto-core as the browser, guaranteeing 100%
// cross-platform compatibility. Reached through the gateway via relative path
// + ?XTransformPort=3001 (never write host/port in client URLs).
import {
  encryptFileStream,
  decryptFileStream,
  inspectFileStream,
  encryptTextToBase64,
  decryptTextFromBase64,
  bytesToBase64,
  CORE_INFO,
  type FileMeta,
} from "../../crypto-core/src/index.ts";

const PORT = 3001;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS, ...extra },
  });
}

/** Turn an async generator<Uint8Array> into a ReadableStream for streaming responses. */
function genToStream(gen: AsyncGenerator<Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await gen.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      } catch (e: any) {
        controller.error(encoder.encode(e?.message || "stream error"));
      }
    },
    cancel() {
      gen.return(undefined as any);
    },
  });
}

async function fileToBytes(f: File | null): Promise<Uint8Array> {
  if (!f) throw new Error("Missing file field");
  return new Uint8Array(await f.arrayBuffer());
}

async function* bytesGen(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      // ---- health ----
      if (path === "/api/health" && req.method === "GET") {
        return json({ ok: true, core: CORE_INFO, port: PORT });
      }

      // ---- text encrypt ----
      if (path === "/api/encrypt/text" && req.method === "POST") {
        const { text, password, note } = await req.json();
        if (typeof text !== "string" || typeof password !== "string")
          return json({ error: "text and password required" }, 400);
        const data = await encryptTextToBase64(text, password, note || "");
        return json({ data });
      }

      // ---- text decrypt ----
      if (path === "/api/decrypt/text" && req.method === "POST") {
        const { data, password } = await req.json();
        if (typeof data !== "string" || typeof password !== "string")
          return json({ error: "data and password required" }, 400);
        const { text, meta } = await decryptTextFromBase64(data, password);
        return json({ text, meta });
      }

      // ---- inspect (no password) ----
      if (path === "/api/inspect" && req.method === "POST") {
        const form = await req.formData();
        const bytes = await fileToBytes(form.get("file") as File);
        const { meta, thumbnail, dataOffset } = await inspectFileStream(bytesGen(bytes));
        const hasThumbnail = !!thumbnail && thumbnail.length > 0;
        return json({
          meta,
          hasThumbnail,
          thumbnailBase64: hasThumbnail ? bytesToBase64(thumbnail!) : undefined,
          dataOffset,
        });
      }

      // ---- file encrypt (streaming response) ----
      if (path === "/api/encrypt/file" && req.method === "POST") {
        const form = await req.formData();
        const file = form.get("file") as File;
        const password = String(form.get("password") || "");
        const metaRaw = String(form.get("meta") || "{}");
        const meta = JSON.parse(metaRaw) as FileMeta;
        if (!file) return json({ error: "file required" }, 400);
        if (!password) return json({ error: "password required" }, 400);

        const fileBytes = await fileToBytes(file);
        let thumbnail: Uint8Array | undefined;
        const thumbField = form.get("thumbnail");
        if (thumbField instanceof File) {
          thumbnail = await fileToBytes(thumbField);
        }

        const gen = encryptFileStream({
          meta,
          thumbnail,
          password,
          plaintext: bytesGen(fileBytes),
        });
        const stream = genToStream(gen);
        const filename = (meta.originalName || "file") + ".enc";
        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
            ...CORS,
          },
        });
      }

      // ---- file decrypt ----
      // We buffer the decrypted output so a wrong password yields a clean 400
      // (the PKCS7 check only fails on the final block, after streaming headers
      // would already be sent). The browser WebWorker path is the true streaming
      // path for TB-scale files; the backend service mode prioritises clean error
      // handling for service-controlled workflows.
      if (path === "/api/decrypt/file" && req.method === "POST") {
        const form = await req.formData();
        const file = form.get("file") as File;
        const password = String(form.get("password") || "");
        if (!file) return json({ error: "file required" }, 400);
        if (!password) return json({ error: "password required" }, 400);

        const bytes = await fileToBytes(file);
        let meta: FileMeta;
        try {
          meta = (await inspectFileStream(bytesGen(bytes))).meta;
        } catch {
          meta = { originalName: "decrypted.bin", originalSize: 0, mimeType: "application/octet-stream", extension: "bin", createdAt: "", encryptedAt: "", note: "" };
        }
        // Buffer the decrypted output; a wrong password throws here.
        const parts: Uint8Array[] = [];
        for await (const c of decryptFileStream({ password, ciphertext: bytesGen(bytes) })) {
          parts.push(c);
        }
        let total = 0;
        for (const p of parts) total += p.length;
        const out = new Uint8Array(total);
        let off = 0;
        for (const p of parts) { out.set(p, off); off += p.length; }
        const filename = meta.originalName || "decrypted.bin";
        return new Response(out, {
          status: 200,
          headers: {
            "Content-Type": meta.mimeType || "application/octet-stream",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(filename)}"`,
            "Content-Length": String(total),
            ...CORS,
          },
        });
      }

      return json({ error: "Not found", path }, 404);
    } catch (e: any) {
      const msg = e?.message || String(e);
      const status = /password|padding|PKCS7|magic|version|encrypt/i.test(msg) ? 400 : 500;
      return json({ error: msg }, status);
    }
  },
});

console.log(`🔒 Crypto backend running on http://localhost:${PORT}`);
console.log(`   Core: ${CORE_INFO.algorithm} | ${CORE_INFO.kdf} (${CORE_INFO.iterations} iters)`);
