import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  resolve: {
    alias: {
      "@crypto-core/src": path.resolve(__dirname, "../crypto-core/src"),
      "@crypto-core": path.resolve(__dirname, "../crypto-core/src/index.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 3000,
    host: "0.0.0.0",
    // Allow all hosts so the app works behind any reverse proxy / gateway
    // (Caddy, Vercel preview, cloud function URLs, etc.)
    allowedHosts: true,
    hmr: false,
    fs: { allow: [path.resolve(__dirname, "..")] },
  },
  // SPA: always fall back to index.html so client-side routing works on Vercel.
  preview: {
    port: 3000,
    host: "0.0.0.0",
  },
  build: {
    outDir: "dist",
    target: "esnext",
  },
  assetsInclude: ["**/*.wasm"],
  worker: { format: "es" },
});
