# 服务器运维手册（RUNBOOK）

> 阿里云 ECS `39.102.98.21`，Alibaba Cloud Linux 8（dnf 系），root。日常开发见 [`../DEVELOP.md`](../DEVELOP.md)。

## 架构一览

```
本地 git push origin main
        │（SSH 到阿里云，只传改动，快）
        ▼
裸仓库 /opt/git/inogi-ai-office.git  ── post-receive 钩子
        │  检出代码到工作目录，触发 scripts/deploy.sh
        ▼
工作目录 /opt/inogi-ai-office-system
        │  装依赖(镜像) → 构建前端 → argon2自愈 → 构建后端
        │  → 备份数据库 → prisma migrate → 发布前端 → 重启 → reload nginx
        ▼
  后端 pm2「inogi-api」(:3000)   前端 dist → /usr/share/nginx/html/weoxy-test
  数据库 原生 PostgreSQL「inogi」(localhost:5432)   nginx 站点 weoxymedical.com
```

关键路径：
- 工作目录：`/opt/inogi-ai-office-system`
- 裸仓库：`/opt/git/inogi-ai-office.git`（钩子在 `hooks/post-receive`）
- 前端发布目录（nginx root）：`/usr/share/nginx/html/weoxy-test`
- nginx 站点配置：`/etc/nginx/conf.d/office.conf`
- 数据库备份：`/opt/inogi-backups/db-<版本>.sql.gz`（自动保留最近 10 份）
- 后端配置：`/opt/inogi-ai-office-system/apps/api/.env`

## 一次性前置环境（重装服务器时需要）

```bash
# 编译工具链 + 新版 Python（argon2 等原生模块从源码编译需要）
dnf install -y gcc gcc-c++ make python3.11 rsync postgresql
npm install -g node-gyp pm2                    # node-gyp 需 Python ≥3.8
corepack enable                                 # 启用 pnpm

# 国内镜像（防超时）
npm config set registry https://registry.npmmirror.com
cat >> /etc/environment <<'EOF'
PRISMA_ENGINES_MIRROR=https://registry.npmmirror.com/-/binary/prisma
EOF
```

> deploy.sh 运行时也会自动注入这些镜像，但机器级固化更稳。

## 日常发版

开发者本地 `git push origin main` 即可，全自动。无需上服务器。

## 手动部署（绕过钩子）

```bash
cd /opt/inogi-ai-office-system
SHA=$(git --git-dir=/opt/git/inogi-ai-office.git rev-parse --short main)
DEPLOY_SKIP_GIT=1 DEPLOY_GIT_SHA="$SHA" bash scripts/deploy.sh
```

可用环境变量：`DEPLOY_DB_BACKUP=0`（关备份）、`WEB_ROOT`（前端发布目录）、`PM2_APP_NAME`、`DEPLOY_BACKUP_KEEP`。

## 数据库：备份与恢复

- **自动备份**：每次部署在迁移前自动 `pg_dump` 到 `/opt/inogi-backups/`，失败则中止部署。
- **手动备份**：`bash scripts/deploy.sh` 会做；或单独 `DEPLOY_DB_BACKUP=1` 跑。
- **恢复**（会覆盖现有数据，需输 yes 确认）：
  ```bash
  bash deploy/db/restore.sh                       # 不带参数会列出可用备份
  bash deploy/db/restore.sh /opt/inogi-backups/db-xxxx.sql.gz
  ```

## 故障排查

### 全站 502 / 后端反复重启（`pm2 ls` 的 ↺ 猛涨）
看日志：`pm2 logs inogi-api --lines 50 --nostream`
- **`ERR_DLOPEN_FAILED ... GLIBC_2.34 not found ... argon2`** —— argon2 预编译与本机 glibc 不兼容。
  deploy.sh 的 `ensure_native_argon2` 会自动从源码编译修复；若需手动：
  ```bash
  cd /opt/inogi-ai-office-system/node_modules/.pnpm/argon2@*/node_modules/argon2
  rm -rf prebuilds build
  node-gyp rebuild --python /usr/bin/python3.11
  pm2 restart inogi-api
  ```
  前置：`gcc/gcc-c++/make` + `python3.11` + 全局 `node-gyp`（见上）。
- 数据库连不上：检查 `apps/api/.env` 的 `DATABASE_URL`、`systemctl status postgresql`。

### 钩子部署时 `node: command not found`
git 钩子环境精简。钩子已显式加 `/usr/bin` 到 PATH；若 node 在别处，编辑
`/opt/git/inogi-ai-office.git/hooks/post-receive` 里的 `export PATH=...`。

### 前端改了但页面没变
- 确认部署日志有 `发布前端 dist → /usr/share/nginx/html/weoxy-test`；
- 确认 nginx `office.conf` 的 `root` 指向该目录；
- 浏览器硬刷新（Cmd/Ctrl+Shift+R）。index.html 已配 no-store，正常情况下刷新即最新。

### pnpm 报 `Ignored build scripts`
`pnpm-workspace.yaml` 的 `onlyBuiltDependencies` 已列出需要构建的原生包；新增原生依赖时往里加。

## nginx 缓存（痛点③）

`office.conf` 的 weoxymedical 443 块里：`index.html` → `no-store`（每次校验、免清缓存）；
`/assets/` → `immutable` 一年强缓存（文件名带 hash，变了才重下）。改完务必 `nginx -t && nginx -s reload`。
