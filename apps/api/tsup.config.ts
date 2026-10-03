import { defineConfig } from "tsup";

/**
 * Self-contained bundles: every dependency is inlined so the output runs without node_modules
 * (Vercel's Fastify builder places the server file at the function root, away from node_modules).
 *
 * server → CommonJS (dist/server.cjs). Vercel's Node launcher loads the entry with require(), and
 * with no "type": "module" next to it at /var/task an ES-module file fails with
 * "SyntaxError: Cannot use import statement outside a module". server.ts has no top-level await.
 *
 * worker → ES module (dist/worker.js). Runs on Render with plain `node`; it uses top-level await.
 */
const shared = {
  platform: "node",
  target: "node22",
  splitting: false,
  sourcemap: true,
  noExternal: [/.*/],
} as const;

export default defineConfig([
  {
    ...shared,
    entry: ["src/server.ts"],
    format: ["cjs"],
    clean: true,
    outExtension: () => ({ js: ".cjs" }),
  },
  {
    ...shared,
    entry: ["src/worker.ts"],
    format: ["esm"],
    clean: false,
    // Gives bundled CommonJS deps (fastify, stripe) a working `require` inside ESM.
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
  },
]);
