import { defineConfig } from "eslint/config";
import nextConfig from "../config/eslint.next.mjs";

export default defineConfig([
  ...nextConfig,
  { rules: { "@next/next/no-img-element": "off", "@next/next/no-html-link-for-pages": "off" } },
]);
