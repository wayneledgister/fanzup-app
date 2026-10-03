import { defineConfig } from "tsup";
export default defineConfig({
  entry: ["src/server.ts", "src/worker.ts"],
  format: ["esm"],
  target: "node22",
  clean: true,
  // Bundle the workspace package (it ships TypeScript source); keep real npm deps external.
  noExternal: ["@fanzup/shared"],
});
