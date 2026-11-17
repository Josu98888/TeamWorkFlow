import type { NextConfig } from "next";

// The browser calls the public API with relative paths (`/api/v1/...`); in development Next forwards them
// to the reverse proxy that publishes core and telemetry under one origin, so no CORS is needed.
const backendUrl = process.env.BACKEND_URL ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  // Self-contained server bundle (`.next/standalone/server.js`) for the production Docker image.
  output: "standalone",
  async rewrites() {
    return [{ source: "/api/v1/:path*", destination: `${backendUrl}/api/v1/:path*` }];
  },
};

export default nextConfig;
