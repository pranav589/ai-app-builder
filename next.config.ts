import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The agent type-checks generated files on the server; keep the compiler out of the bundle.
  serverExternalPackages: ["typescript"],
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
