import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const previewRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(previewRoot, "../..");
const isolation: Plugin = { name: "device-records-preview-isolation", configureServer(server) {
  server.middlewares.use((request, response, next) => {
    response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' ws://127.0.0.1:5185; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; form-action 'none'; base-uri 'none'");
    response.setHeader("X-Device-Records-Preview", "local-synthetic-data");
    if ((request.url || "").startsWith("/api/") || !["GET", "HEAD"].includes(request.method || "GET")) { response.writeHead(405, { "Content-Type": "application/json; charset=utf-8" }); response.end(JSON.stringify({ message: "本地预览只使用合成数据。" })); return; }
    next();
  });
} };
export default defineConfig({ root: previewRoot, envDir: false, envPrefix: "DEVICE_RECORDS_PREVIEW_UNUSED_", cacheDir: resolve(previewRoot, ".cache"), plugins: [isolation, react(), tailwindcss()],
  define: { "import.meta.env.VITE_API_BASE": JSON.stringify("") }, resolve: { dedupe: ["react", "react-dom"], alias: { "@": resolve(repositoryRoot, "src") } },
  server: { host: "127.0.0.1", port: 5185, strictPort: true, fs: { allow: [repositoryRoot] } }, build: { outDir: resolve(previewRoot, ".build"), emptyOutDir: true } });
