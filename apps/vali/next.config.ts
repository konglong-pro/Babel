import type { NextConfig } from "next";

import { resolveBabelRoot } from "./src/lib/db/paths";

const monorepoRoot = resolveBabelRoot();

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  outputFileTracingRoot: monorepoRoot,
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
