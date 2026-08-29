import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next's bundled eslint-plugin-react auto-detects the React
  // version via `context.getFilename()`, an API this repo's ESLint (10.x)
  // no longer exposes — that throws "contextOrFilename.getFilename is not
  // a function" from react/display-name on every file. Setting an explicit
  // version (matching package.json's "react") skips detection entirely.
  {
    settings: { react: { version: "19.2.3" } },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
