import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The agent type-checks generated files on the server; keep the compiler out of the bundle.
  serverExternalPackages: ["typescript"],
  // A ZIP/GitHub export of a connected app ships a copy of these source files (lib/app-project/self-host.ts reads them at request time, which the bundler can't see).
  outputFileTracingIncludes: {
    "/api/projects/**/*": ["./lib/cloudhike/app-data.ts", "./lib/cloudhike/app-ops.ts", "./lib/app-runtime/data-model-types.ts"],
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
