import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // pdf.js worker, CMaps and WASM decoders, copied in from pdfjs-dist at build time
    // by scripts/copy-pdf-assets.mjs. Minified vendor output, not ours to lint.
    "public/pdf/**",
  ]),
]);

export default eslintConfig;
