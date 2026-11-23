import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@app/shared"],
  // The Express backend owns /api, but OAuth callbacks, webhooks, app-files URLs, the ZIP
  // download and exported apps all address /api on this origin; forwarding keeps those
  // URLs working without re-registering them.
  async rewrites() {
    const backend = (process.env.BACKEND_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "")
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }]
  },
  // Preview frames are sandboxed (opaque origin), so the runtime's font needs CORS.
  async headers() {
    return [
      {
        source: "/preview/:path*",
        headers: [
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Cache-Control", value: "public, max-age=300, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
