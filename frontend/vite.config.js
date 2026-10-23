import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// In dev, /api is proxied to the backend so no CORS setup is needed.
// For a split deployment, set VITE_API_BASE_URL at build time instead.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_PROXY_TARGET || "http://127.0.0.1:8000";
  const proxy = { "/api": { target, changeOrigin: true } };
  return {
    plugins: [react()],
    server: { port: 5173, proxy },
    preview: { port: 4173, proxy },
  };
});
