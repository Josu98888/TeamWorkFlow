import type { NextConfig } from "next";

// The browser calls the public API with relative paths (`/api/v1/...`); Next forwards them to the backend, so
// no CORS is needed. Locally (and in the nginx compose) one reverse proxy publishes core and telemetry under
// one origin: `BACKEND_URL`. When core and telemetry are separate hosts (Vercel + Render + Koyeb), set
// `CORE_URL` and `TELEMETRY_URL`; each falls back to `BACKEND_URL` when unset or empty. Read at build time.
const trimTrailingSlashes = (url: string) => url.replace(/\/+$/, "");
const backendUrl = trimTrailingSlashes(process.env.BACKEND_URL || "http://localhost:8080");
const coreUrl = trimTrailingSlashes(process.env.CORE_URL || backendUrl);
const telemetryUrl = trimTrailingSlashes(process.env.TELEMETRY_URL || backendUrl);

const nextConfig: NextConfig = {
  // Self-contained server bundle (`.next/standalone/server.js`) for the production Docker image.
  output: "standalone",
  async rewrites() {
    // Order matters: the telemetry prefix is a subset of `/api/v1/*`, so it must come first.
    return [
      { source: "/api/v1/telemetry/:path*", destination: `${telemetryUrl}/api/v1/telemetry/:path*` },
      { source: "/api/v1/:path*", destination: `${coreUrl}/api/v1/:path*` },
    ];
  },
};

export default nextConfig;
