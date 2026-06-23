import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

// Minimal config — let vite-plugin-solid handle solid-js resolution itself.
// (Manual solid-js aliases break the dev/prod build selection and cause
//  isServer=true in the browser, which kills reactivity.)
// Vite runs directly on port 3000 so the gateway serves the SolidJS app at `/`
// with no Next.js proxy layer.
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
    hmr: false,
    fs: { allow: [path.resolve(__dirname, "..")] },
  },
  assetsInclude: ["**/*.wasm"],
  worker: { format: "es" },
});
