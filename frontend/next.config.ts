import type { NextConfig } from "next";

// `/api/v1/**` is served by the route handler `app/api/v1/[...path]` (auth BFF), which forwards to
// `BACKEND_URL` adding the bearer token from the httpOnly cookie; no rewrite is needed.
const nextConfig: NextConfig = {};

export default nextConfig;
