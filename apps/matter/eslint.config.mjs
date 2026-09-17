import { defineConfig, globalIgnores } from "eslint/config";
import nextConfig from "../../packages/config/eslint.next.mjs";

export default defineConfig([
  ...nextConfig,
  globalIgnores([".next/**", "drizzle/**", "next-env.d.ts"]),
]);
