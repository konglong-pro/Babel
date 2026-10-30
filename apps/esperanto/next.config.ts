import path from "node:path";

import type { NextConfig } from "next";

const monorepoRoot = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/html-reader", headers: [
      { key: "Content-Security-Policy", value: "default-src 'none'; script-src 'self' blob: 'unsafe-inline' 'unsafe-eval'; style-src 'self' blob: 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; media-src 'self' blob: data:; connect-src 'self' blob:; frame-src blob:; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'; manifest-src 'none'" },
      { key: "Referrer-Policy", value: "no-referrer" },
    ] }];
  },
  outputFileTracingRoot: monorepoRoot,
  serverExternalPackages: ["better-sqlite3"],
  transpilePackages: ["@babel-apps/markdown", "@babel-apps/platform", "@babel-apps/pdf", "@babel-apps/html", "@babel-apps/typst"],
  turbopack: {
    root: monorepoRoot,
  },
};

export default nextConfig;
