import { defineConfig } from "tsup";

/**
 * Self-contained bundles: every dependency is inlined so dist/server.js runs without node_modules.
 * Why: Vercel's Fastify builder places dist/server.js at the function root, away from
 * apps/api/node_modules, so bare imports ("fastify", "jose", …) failed with ERR_MODULE_NOT_FOUND
 * and every /api request returned FUNCTION_INVOCATION_FAILED. Render runs the same bundle.
 * The banner gives bundled CommonJS deps (fastify, stripe) a working `require` inside ESM.
 */
export default defineConfig({
  entry: ["src/server.ts", "src/worker.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  clean: true,
  splitting: false,
  sourcemap: true,
  noExternal: [/.*/],
  banner: {
    js: [
      'import { createRequire as __fz_createRequire } from "node:module";',
      'import { fileURLToPath as __fz_fileURLToPath } from "node:url";',
      'import { dirname as __fz_dirname } from "node:path";',
      "const require = __fz_createRequire(import.meta.url);",
      "const __filename = __fz_fileURLToPath(import.meta.url);",
      "const __dirname = __fz_dirname(__filename);",
    ].join("\n"),
  },
});
