import type { NextConfig } from "next";

// The user-facing `/` route is served by a SolidJS + Vite + Tailwind frontend
// (port 5173). We proxy ALL paths to the Vite dev server via a beforeFiles
// rewrite so that Vite's absolute module paths (/src/..., /@vite/...,
// /node_modules/.vite/deps/...) resolve correctly at `/` without needing the
// gateway XTransformPort query on every sub-resource.
// Backend API calls from the app carry `?XTransformPort=3001` and are routed by
// the gateway directly to the Bun service — they never reach Next.js.
const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/:path*",
          destination: "http://127.0.0.1:5173/:path*",
        },
      ],
    };
  },
};

export default nextConfig;
