import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": path.resolve(import.meta.dirname, "src") },
    },
    server: {
      // The browser calls /api on the Vite origin and Vite forwards it, so the
      // UI works without CORS and without knowing where the API runs.
      proxy: {
        "/api": {
          target: env.API_URL ?? "http://localhost:3000",
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
      },
    },
  };
});
