import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // Expose only public values: our VITE_* vars plus the two public ones the Supabase ↔ Vercel integration
  // injects (URL + anon/publishable key). Never widen this to anything that could carry a secret.
  envPrefix: ["VITE_", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
  server: {
    // Local dev mirrors production: the browser calls same-origin /api/*, which Vercel routes to the
    // `api` service. With `pnpm dev:web` alone, Vite forwards /api to the API on :8787.
    // (`vercel dev` at the repo root runs both services and does this routing itself.)
    proxy: { "/api": { target: process.env.API_PROXY_TARGET ?? "http://localhost:8787", changeOrigin: false } },
  },
});
