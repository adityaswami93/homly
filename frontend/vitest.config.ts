import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `node`, not `jsdom`: everything covered so far is pure logic in lib/ and
    // config/. Switch this to "jsdom" (and add @testing-library/react) when the
    // first component test lands — not before, since jsdom costs startup time
    // on every run.
    environment: "node",
    include: ["{lib,config,app}/**/*.test.{ts,tsx}"],
  },
  resolve: {
    // Mirrors the `@/*` path alias in tsconfig.json. Both have to agree, or
    // imports resolve under tsc and fail under vitest.
    //
    // process.cwd() rather than __dirname: this file is TypeScript loaded by
    // Vite, which may hand it to either module system, and __dirname exists in
    // only one of them. npm scripts run from the package root, which is what
    // this needs to be.
    alias: { "@": path.resolve(process.cwd()) },
  },
});
