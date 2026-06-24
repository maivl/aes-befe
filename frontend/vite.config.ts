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
    allowedHosts: true,
    // Completely disable HMR — the app runs behind a gateway/proxy that breaks
    // the HMR websocket and causes Vite to crash.
    hmr: false,
    ws: false,
    fs: { allow: [path.resolve(__dirname, "..")] },
  },
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
