import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixtureFor } from "./fixtures";
import { closureFixture, closureWrite, syntheticWritePaths } from './closure-fixtures';

const previewRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(previewRoot, "../..");
const authModule = resolve(repositoryRoot, "src/app/auth");
const authSessionModule = resolve(repositoryRoot, "src/app/lib/authSession");
const authSessionPreview = resolve(previewRoot, "auth-session-preview.ts");

function isolatedPreview(): Plugin {
  return {
    name: "isolated-read-only-ui-preview", enforce: "pre",
    resolveId(source, importer) {
      if (!importer || !source.startsWith(".")) return null;
      const importerFile = resolve(importer.split("?")[0]);
      const candidate = resolve(dirname(importerFile), source).replace(/\.[jt]sx?$/, "");
      // The preview shim re-exports the real helpers; only its own import bypasses the alias.
      if (candidate === authSessionModule && importerFile !== authSessionPreview) return authSessionPreview;
      return candidate === authModule ? resolve(previewRoot, "auth-preview.tsx") : null;
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        response.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' ws://127.0.0.1:5175 ws://localhost:5175; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; object-src 'none'; form-action 'none'; base-uri 'none'");
        response.setHeader("X-UI-Preview", "synthetic-fixtures-only");
        const url = new URL(request.url || "/", "http://127.0.0.1:5175");
        const scenario = new URL(request.headers.referer || '/', 'http://127.0.0.1:5175').searchParams.get('previewScenario') || '';
        if (request.method === 'POST' && syntheticWritePaths.has(url.pathname) && (url.pathname.startsWith('/api/order-processing/') || scenario === 'bom-flow')) {
          let body = ''; request.on('data', chunk => { body += chunk; if (body.length > 10000) request.destroy(); });
          request.on('end', () => { try { const result = closureWrite(url.pathname, request.method!, JSON.parse(body), scenario)!; response.writeHead(result.status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(result.body)); } catch { response.writeHead(400); response.end('{}'); } });
          return;
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
          response.writeHead(405, { "Content-Type": "application/json", Allow: "GET, HEAD" });
          response.end(JSON.stringify({ message: "独立 UI 验收沙箱：所有写入均已禁用。Synthetic preview: all writes are disabled." }));
          return;
        }
        if (!url.pathname.startsWith("/api/")) { next(); return; }
        const fixture = closureFixture(url.pathname, url.searchParams, scenario) ?? fixtureFor(url.pathname, url.searchParams);
        response.writeHead(fixture === undefined ? 404 : 200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        response.end(JSON.stringify(fixture ?? { message: `No synthetic fixture for ${url.pathname}` }));
      });
    },
  };
}

export default defineConfig({
  root: previewRoot, envDir: previewRoot, envPrefix: "UI_PREVIEW_UNUSED_",
  cacheDir: resolve(previewRoot, ".cache"),
  plugins: [isolatedPreview(), react(), tailwindcss()],
  define: { "import.meta.env.VITE_API_BASE": JSON.stringify(""), "import.meta.env.VITE_RECRUITMENT_API_BASE": JSON.stringify("") },
  resolve: { dedupe: ["react", "react-dom"], alias: { "@": resolve(repositoryRoot, "src") } },
  server: { host: "127.0.0.1", port: 5175, strictPort: true, fs: { allow: [repositoryRoot] } },
  // Deliberately no proxy, production entry point, credentials, or database client.
});
