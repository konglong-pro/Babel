import path from "node:path";

import type { NextConfig } from "next";

const monorepoRoot = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
