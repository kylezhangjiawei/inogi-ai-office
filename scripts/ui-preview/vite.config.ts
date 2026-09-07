import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureFor } from "./fixtures";

const previewRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(previewRoot, "../..");
const authModule = resolve(repositoryRoot, "src/app/auth");

function isolatedPreview(): Plugin {
  return {
    name: "isolated-read-only-ui-preview", enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !source.startsWith(".")) return null;
      const candidate = resolve(dirname(importer.split("?")[0]), source).replace(/\.[jt]sx?$/, "");
      return candidate === authModule ? resolve(previewRoot, "auth-preview.tsx") : null;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' ws://127.0.0.1:5175 ws://localhost:5175; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; form-action 'none'; base-uri 'none'");
        response.setHeader("X-UI-Preview", "synthetic-fixtures-only");
        const url = new URL(request.url || "/", "http://127.0.0.1:5175");
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405, { "Content-Type": "application/json", Allow: "GET, HEAD" });
          response.end(JSON.stringify({ message: "独立 UI 验收沙箱：所有写入均已禁用。Synthetic preview: all writes are disabled." }));
          return;
        }
        if (!url.pathname.startsWith("/api/")) { next(); return; }
        const fixture = fixtureFor(url.pathname, url.searchParams);
        response.writeHead(fixture === undefined ? 404 : 200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify(fixture ?? { message: `No synthetic fixture for ${url.pathname}` }));
      });
    },
  };
}

export default defineConfig({
  root: previewRoot, envDir: previewRoot, envPrefix: "UI_PREVIEW_UNUSED_",
  plugins: [isolatedPreview(), react(), tailwindcss()],
  define: { "import.meta.env.VITE_API_BASE": JSON.stringify(""), "import.meta.env.VITE_RECRUITMENT_API_BASE": JSON.stringify("") },
  resolve: { dedupe: ["react", "react-dom"], alias: { "@": resolve(repositoryRoot, "src") } },
  server: { host: "127.0.0.1", port: 5175, strictPort: true, fs: { allow: [repositoryRoot] } },
  // Deliberately no proxy, production entry point, credentials, or database client.
});
