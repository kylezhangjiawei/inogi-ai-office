import { defineConfig } from 'vite'
import path from 'path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string
// Keep standalone `npm run dev:web` aligned with the dedicated API port used by
// `npm run dev`; the parallel Intellifai project uses frontend 5380 and BFF 3000.
const devApiTarget = process.env.VITE_DEV_API_TARGET || 'http://127.0.0.1:3011'
const spaClientDirectivePattern = /^(\uFEFF?[\t ]*)(["'])use client\2;?[\t ]*(\r?\n|$)/

function stripSpaClientDirectives() {
  return {
    name: 'strip-spa-client-directives',
    enforce: 'pre' as const,
    transform(code: string, id: string) {
      const moduleId = id.split('?', 1)[0].replace(/\\/g, '/')
      if (!moduleId.includes('/src/') || !/\.[cm]?[jt]sx?$/.test(moduleId)) return null
      const match = spaClientDirectivePattern.exec(code)
      if (!match) return null

      // `use client` only has meaning in React Server Components. This is a Vite SPA,
      // so blank the directive while preserving every character position for sourcemaps.
      const blankedDirective = match[0].replace(/[^\r\n]/g, ' ')
      return { code: `${blankedDirective}${code.slice(match[0].length)}`, map: null }
    },
  }
}

function enforceJavaScriptChunkBudget(maxBytes = 2_000_000) {
  return {
    name: 'enforce-javascript-chunk-budget',
    generateBundle(_options: unknown, bundle: Record<string, { type: string; code?: string; modules?: Record<string, { renderedLength: number }> }>) {
      const oversized = Object.entries(bundle)
        .filter(([, output]) => output.type === 'chunk')
        .map(([fileName, output]) => ({
          fileName,
          bytes: Buffer.byteLength(output.code ?? '', 'utf8'),
          modules: Object.entries(output.modules ?? {})
            .map(([id, details]) => ({ id: id.replace(/\\/g, '/'), bytes: details.renderedLength }))
            .sort((left, right) => right.bytes - left.bytes)
            .slice(0, 8),
        }))
        .filter((chunk) => chunk.bytes > maxBytes);
      if (oversized.length === 0) return
      const details = oversized.map((chunk) => [
        `${chunk.fileName}: ${chunk.bytes} bytes`,
        ...chunk.modules.map((module) => `  ${module.bytes} bytes  ${module.id}`),
      ].join('\n')).join('\n')
      throw new Error(`JavaScript chunk budget exceeded (${maxBytes} bytes):\n${details}`)
    },
  }
}

function buildManualChunkName(id: string) {
  const moduleId = id.replace(/\\/g, '/')
  const hyphenationModule = moduleId.match(/\/node_modules\/@univerjs\/engine-render\/lib\/es\/([^/]+)\.js$/)?.[1]
  if (hyphenationModule && hyphenationModule !== 'index') return `univer-hyphenation-${hyphenationModule}`

  const univerPackage = moduleId.match(/\/node_modules\/@univerjs\/([^/]+)\//)?.[1]
  if (univerPackage) return `univer-${univerPackage}`

  // engine-render imports these large data-heavy libraries directly. Without an
  // explicit boundary Rollup folds all of them into the engine chunk (~5.8MB).
  if (moduleId.includes('/node_modules/opentype.js/')) return 'univer-font-parser'
  if (/\/node_modules\/(franc-min|trigram-utils)\//.test(moduleId)) return 'univer-language-detection'
  if (/\/node_modules\/(cjk-regex|unicode-regex|regexp-util)\//.test(moduleId)) return 'univer-unicode-text'
  if (moduleId.includes('/node_modules/rxjs/')) return 'rxjs-vendor'
  if (moduleId.includes('/node_modules/@floating-ui/')) return 'floating-ui-vendor'

  if (/\/node_modules\/(react|react-dom|react-router|scheduler)\//.test(moduleId)) return 'react-vendor'
  if (moduleId.includes('/node_modules/@radix-ui/')) return 'radix-vendor'
  if (/\/node_modules\/(recharts|d3-[^/]+|victory-vendor)\//.test(moduleId)) return 'recharts-vendor'
  if (/\/node_modules\/(motion|framer-motion)\//.test(moduleId)) return 'motion-vendor'
  if (moduleId.includes('/node_modules/lucide-react/')) return 'lucide-vendor'
  if (moduleId.includes('/node_modules/@mui/') || moduleId.includes('/node_modules/@emotion/')) return 'mui-vendor'
  return undefined
}

function resolveGitSha() {
  const fromEnvironment = process.env.VITE_GIT_SHA || process.env.APP_GIT_SHA || process.env.GIT_COMMIT || process.env.SOURCE_VERSION
  if (fromEnvironment) return fromEnvironment.slice(0, 12)
  try {
    return execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  // Preview servers can share this package root; keep their optimizer caches
  // from replacing dependencies used by the running application.
  cacheDir: path.resolve(__dirname, 'node_modules/.vite-app'),
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.VITE_APP_VERSION || packageVersion),
    'import.meta.env.VITE_GIT_SHA': JSON.stringify(resolveGitSha()),
  },
  plugins: [
    figmaAssetResolver(),
    stripSpaClientDirectives(),
    enforceJavaScriptChunkBudget(),
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
      react: path.resolve(__dirname, './node_modules/react'),
      'react-dom': path.resolve(__dirname, './node_modules/react-dom'),
      'react/jsx-runtime': path.resolve(__dirname, './node_modules/react/jsx-runtime.js'),
      'react/jsx-dev-runtime': path.resolve(__dirname, './node_modules/react/jsx-dev-runtime.js'),
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      '@radix-ui/react-select',
    ],
  },
  server: {
    // 监听所有网卡，允许局域网同事通过 http://<本机IP>:5173 访问（/api 仍由下方代理转发到本机后端）
    host: true,
    proxy: {
      '/api': {
        target: devApiTarget,
        changeOrigin: true,
        // 后端未启动时，vite 默认会把每个失败请求打成一大坨 AggregateError 堆栈刷屏。
        // 这里收敛成一行简短日志，并给前端回一个 502，避免请求一直挂起。
        configure(proxy) {
          // vite 在调用 configure 前已挂了自己的 error 处理器（负责打 AggregateError 堆栈），
          // 先移除它，只保留下面这个简短版本，避免刷屏。
          proxy.removeAllListeners('error')
          proxy.on('error', (err, req, res) => {
            const code = err?.code || err?.message || 'proxy error'
            console.warn(`[api proxy] ${req.method} ${req.url} -> ${code}（后端 ${devApiTarget} 是否已启动？）`)
            if (res && 'writeHead' in res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: 'backend unavailable' }))
            }
          })
        },
      },
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],

  build: {
    // 2MB 是真实性能预算，不通过调高阈值掩盖超大依赖块。
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Keep lazy-route dependencies lazy. Otherwise Rollup also absorbs each
        // manual chunk's dependency graph and may promote Univer into index.html.
        onlyExplicitManualChunks: true,
        // RDSheetPage 已按路由懒加载；这里再按 Univer 包边界拆开其内部依赖图，
        // 避免整个电子表格引擎被合并成一个 6MB 异步文件。
        manualChunks: buildManualChunkName,
      },
    },
  },
})
