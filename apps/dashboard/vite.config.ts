import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "dashboard-dev-runtime-config",
      configureServer(server) {
        server.middlewares.use("/runtime-config.js", (_request, response) => {
          response.setHeader("Content-Type", "application/javascript; charset=utf-8");
          // This mirrors production with a non-secret local API path.
          // Authentication still requires a user-supplied API key.
          response.end('window.__URUMI_CONFIG__={apiBaseUrl:"/api"};');
        });
      },
    },
  ],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: { proxy: { "/api": "http://127.0.0.1:3100", "/gateway-healthz": { target: "http://127.0.0.1:3100", rewrite: () => "/healthz" }, "/gateway-readyz": { target: "http://127.0.0.1:3100", rewrite: () => "/readyz" } } },
  build: { outDir: "dist", emptyOutDir: true },
});
