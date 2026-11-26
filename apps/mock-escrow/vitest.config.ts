import { defineConfig } from "vitest/config";
export default defineConfig({ test: { testTimeout: 30_000, env: { NODE_ENV: "test" } } });
