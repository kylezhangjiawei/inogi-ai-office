import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const previewRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(previewRoot, "../..");

function isolatePreview(): Plugin {
  return {
    name: "electronic-gate-preview-isolation",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' ws://127.0.0.1:5184; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; form-action 'none'; base-uri 'none'");
        response.setHeader("X-Electronic-Gate-Preview", "local-synthetic-data");
        const url = new URL(request.url || "/", "http://127.0.0.1:5184");
        if (url.pathname.startsWith("/api/") || !["GET", "HEAD"].includes(request.method || "GET")) {
          response.writeHead(405, { "Content-Type": "application/json; charset=utf-8", Allow: "GET, HEAD" });
          response.end(JSON.stringify({ message: "此交互预览仅使用本地示例数据。" }));
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: previewRoot,
  // Disable .env loading entirely: this host must never inherit API credentials.
  envDir: false,
  envPrefix: "ELECTRONIC_GATE_PREVIEW_UNUSED_",
  cacheDir: resolve(previewRoot, ".cache"),
  plugins: [isolatePreview(), react(), tailwindcss()],
  define: { "import.meta.env.VITE_API_BASE": JSON.stringify("") },
  resolve: { dedupe: ["react", "react-dom"], alias: { "@": resolve(repositoryRoot, "src") } },
  server: { host: "127.0.0.1", port: 5184, strictPort: true, fs: { allow: [repositoryRoot] } },
  build: { outDir: resolve(previewRoot, ".build"), emptyOutDir: true },
  // No API proxy, authentication entry point, or database connection.
});
