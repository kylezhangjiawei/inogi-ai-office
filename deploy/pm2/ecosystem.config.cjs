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
      max_memory_restart: '600M',
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
