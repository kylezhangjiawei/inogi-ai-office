import { defineConfig } from 'vite'
import path from 'path'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version as string
const devApiTarget = process.env.VITE_DEV_API_TARGET || 'http://localhost:3000'

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
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.VITE_APP_VERSION || packageVersion),
    'import.meta.env.VITE_GIT_SHA': JSON.stringify(resolveGitSha()),
  },
  plugins: [
    figmaAssetResolver(),
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
    // 单 chunk 上限 2MB（业务主包目前 ~1.8MB，正常）。
    // 后续可通过 React.lazy 路由懒加载进一步拆分，把首屏 chunk 控制到 < 1MB。
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          // React 全家桶单独打一个包（占很大体积，但很少变化，浏览器缓存命中率高）
          'react-vendor': ['react', 'react-dom', 'react/jsx-runtime', 'react-router'],
          // Radix UI 组件库（大量 UI 原子组件，独立缓存）
          'radix-vendor': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-aspect-ratio',
            '@radix-ui/react-avatar',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-collapsible',
            '@radix-ui/react-context-menu',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-hover-card',
            '@radix-ui/react-label',
            '@radix-ui/react-menubar',
            '@radix-ui/react-navigation-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-progress',
            '@radix-ui/react-radio-group',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-select',
            '@radix-ui/react-separator',
            '@radix-ui/react-slider',
            '@radix-ui/react-slot',
            '@radix-ui/react-switch',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toggle',
            '@radix-ui/react-toggle-group',
            '@radix-ui/react-tooltip',
          ],
          // 大型独立库：图表 / 动画 / 图标 / 表格
          'recharts-vendor': ['recharts'],
          'motion-vendor': ['motion'],
          'lucide-vendor': ['lucide-react'],
          // MUI（如果有用到，比较大）
          'mui-vendor': ['@mui/material', '@mui/icons-material', '@emotion/react', '@emotion/styled'],
        },
      },
    },
  },
})
