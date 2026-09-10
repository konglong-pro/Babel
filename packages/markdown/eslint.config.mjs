import { defineConfig, globalIgnores } from "eslint/config";
import nextConfig from "../config/eslint.next.mjs";

export default defineConfig([
  ...nextConfig,
  {
    rules: {
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  globalIgnores(["next-env.d.ts"]),
]);
