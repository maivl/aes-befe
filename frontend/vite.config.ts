import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import path from "node:path";

export default defineConfig({
  plugins: [solid()],
  resolve: {
    alias: {
      "solid-js": path.resolve(__dirname, "node_modules/solid-js"),
      "@crypto-core": path.resolve(__dirname, "../crypto-core/src/index.ts"),
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    host: "0.0.0.0",
    // The app is reached through the Caddy gateway (iframe in Next.js /).
    // Disable HMR websocket to avoid connection errors behind the proxy;
    // full page reload still works.
    hmr: false,
    fs: {
      // Allow importing the shared crypto-core from outside the frontend root.
      allow: [path.resolve(__dirname, "..")],
    },
  },
  worker: { format: "es" },
});
