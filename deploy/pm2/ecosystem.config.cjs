// pm2 进程定义（后端 NestJS）。
//
// 首次启动：  cd /opt/inogi-ai-office-system && pm2 start deploy/pm2/ecosystem.config.cjs --update-env && pm2 save
// 之后由 scripts/deploy.sh 自动 `pm2 restart inogi-api --update-env`。
//
// APP_VERSION / APP_GIT_SHA 由 deploy.sh 在调用前 export，注入到运行进程，
// 供后端 /api/health 返回，前端据此检测「有新版本」并提示用户刷新。
//
// 注意：DATABASE_URL 等业务配置仍由后端自身的 ConfigModule 从 apps/api/.env 读取，
// 这里只补充版本号与运行模式，避免重复维护敏感配置。

const path = require('path');

const apiDir = path.resolve(__dirname, '..', '..', 'apps', 'api');

module.exports = {
  apps: [
    {
      name: process.env.PM2_APP_NAME || 'inogi-api',
      cwd: apiDir,
      script: 'dist/src/main.js',
      instances: 1,
      exec_mode: 'fork',
      // 内存墙上调：原 600M 对复杂对话（长历史 + 多模态 base64 + 多轮 ReAct 上下文）太紧，
      // 峰值一触顶就整进程重启，所有在途 SSE 同时断线（前端表现为 network error、未落库回答丢失）。
      // 抬到 1400M 留足峰值余量，restart 仍作为真内存泄漏的兜底保留（不是取消，是给对话留出空间）。
      // 注意：本进程仍是单实例——保持单实例是刻意的，跨轮工具轨迹/会话摘要用单行 KV 存储，
      // 多实例会放大并发写覆盖问题；扩容前需先把那部分状态迁到按会话隔离的存储。
      // ⚠️ 生效前请确认 ECS 可用内存 ≥ 2GB（1400M 上限 + 系统与其他进程余量）。
      max_memory_restart: '1400M',
      // V8 老生代堆上限显式设为 1GB：不设时 64 位默认约 2GB，可能先撞 RSS 墙触发 pm2 硬重启
      // （丢弃全部在途请求）；设了之后 V8 会在接近上限时更积极 GC，把「硬重启」尽量降级为「GC 压力」。
      node_args: '--max-old-space-size=1024',
      // 崩溃自动重启 + 退避，避免反复秒崩刷日志
      autorestart: true,
      restart_delay: 3000,
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || '3000',
        APP_VERSION: process.env.APP_VERSION || 'dev',
        APP_GIT_SHA: process.env.APP_GIT_SHA || 'unknown',
      },
    },
  ],
};
