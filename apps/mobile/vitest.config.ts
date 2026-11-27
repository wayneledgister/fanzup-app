import { defineConfig } from "vitest/config";

// Pure modules only (no React Native runtime): native screens are covered by typecheck and the bundle check.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
