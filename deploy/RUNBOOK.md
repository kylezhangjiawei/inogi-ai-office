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
        │  计算变更范围 → 只构建/检查受影响的一端
        │  → 仅有 migration 时备份并迁移 → 按需发布前端或重启 API
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
- 发布基线：`/var/log/inogi-deploy/<版本>-<进程号>.json`
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

发布钩子与手动发布使用同一个 `.deploy-cache/release.lock`（系统 `flock`，由 util-linux 提供），覆盖代码检出到发布结束；已有发布时立即返回 75，不覆盖正在构建的工作目录。钩子按收到的提交 SHA 检出，避免并发推送时误用后来的分支头。**升级本次钩子需要先将仓库的 `deploy/git-hooks/post-receive` 同步安装到裸仓库 `hooks/post-receive`；仅推送文件不会自动更新已安装的钩子。** Git 接收成功而发布失败时，代码可能已经在远端，空推送不会重试，请按下方“手动部署”对目标 SHA 重试。

发布计划确定后会提前检查静态发布目录、PM2 与 curl，避免等待全部构建测试后才发现环境缺项。缺少前后端入口产物时强制重建；构建返回成功但入口产物为空时，也会在迁移和重启前中止。

发布脚本会把成功版本的输入指纹保存到 `.deploy-cache/deploy-inputs.json`。下一次发布按内容变化选择阶段：

- 纯前端改动：前端类型检查、业务脚本测试、前后端契约测试、前端构建与静态文件同步；后端 TS 与数据库检查可按有效记录复用；
- 纯 API 改动：API 构建、API 类型检查（含 `test/*.spec.ts`）、API 测试、PM2 重启；
- Prisma schema 改动：重新生成 Client，并构建/测试 API；
- migration 改动：先备份数据库，再执行 `prisma migrate deploy`；
- 文档等非运行文件改动：跳过构建与重启。

后端 `dist/` 不再每次构建前清空（靠 tsconfig 的 `incremental` 复用上次编译结果），前端类型检查同样增量、状态存在 `.deploy-cache/tsbuildinfo-web`。怀疑后端 dist 里有重命名/删除留下的陈旧产物时，执行 `rm -rf /opt/inogi-ai-office-system/apps/api/dist` 后重新发布即可。

首次启用、缓存丢失或发布逻辑自身变化时会保守执行一次全量发布。变更快照只在全部阶段成功后更新，失败重试不会误跳过阶段。

质量检查另按组保存通过记录（`.deploy-cache/quality-inputs.json`）：后面的 API 测试失败时，前面已经通过且输入未变化的类型检查、脚本检查可以在重试中复用。失败组没有通过记录；源代码、测试、配置、运行环境或依赖变化会使相关记录失效。显式关闭检查、强制全量发布、重新安装依赖时会撤销旧记录。发布成功快照仍只在全部部署步骤成功后更新，数据库备份、迁移和健康检查不会因此绕过。

API 的 TypeScript 测试由 `scripts/run-tests.cjs` 先统一增量编译到仓库 `.deploy-cache/api-test-build/`，再在独立测试进程中运行编译结果，避免每个进程重新加载 TypeScript 并转译相同业务代码。测试仍使用原始源码路径解析附件、目录和路径别名，错误堆栈映射回 TypeScript；全部断言照常执行。源文件及配置变化由 TypeScript 增量编译处理，JS 或 source map 丢失时自动重建；编译失败直接阻止测试和发布，不复用旧产物继续发布。API 类型检查使用同一 runner 的 `--compile-only`，不再额外维护一份 noEmit 编译状态；测试启动时仍运行增量编译以防源码或输出变化。读取前端实现的断言已集中到 `.spec.mts` 契约组，前端变化不再触发后端 TS 全量测试。契约组先于 TS 全量测试运行，两组及五组 PostgreSQL 验收分别保存通过记录。所有质量检查在生产构建之前执行，尽早暴露失败。

每次发布都会额外写一份结构化基线记录，不改变原有发布结果。查看最近一次：

```bash
latest="$(find /var/log/inogi-deploy -maxdepth 1 -type f -name '*.json' -printf '%T@ %p\n' \
  | sort -nr | head -n1 | cut -d' ' -f2-)"
[ -n "$latest" ] && python3 -m json.tool "$latest"
```

记录包含完整 Git SHA、触发方式、模式（prepare / artifact-deploy / source-deploy）、Node 版本、毫秒级总耗时、22 个固定阶段的状态/耗时/阶段内系统 CPU 与内存峰值，以及整次部署期间的系统峰值。其中 `database_backup` 记的是「还需要等待后台备份多久」，不是备份总耗时（总耗时见同次发布的文本日志）。记录采用字段白名单，不包含命令行、环境变量、原始错误文本或 `DATABASE_URL`。目录不可写或 `/proc` 指标不可用时只告警，部署继续执行。

## 失败重试与独立构建产物

默认发布继续使用原入口，无需新增服务。前后端成功构建分别记录在 `.deploy-cache/build-frontend.json` 和 `build-api.json`；同一提交重试时，输入指纹、运行环境与整个输出目录逐文件校验一致才复用。丢文件、内容改变或新提交会重建。前端复用时保留编译时注入的版本号，避免客户端和健康检查版本不一致。强制全量模式仍不复用记录。

可选的独立构建使用相同脚本和质量闸门；不需要新依赖。先准备一台受信任的 Linux 构建机或 Runner，与生产保持相同 Node 精确版本、CPU 架构和 libc 版本，提供隔离 PostgreSQL 验收所需工具。当前产物校验保守要求源码、锁文件、配置文件（含受保护的 dotenv 文件）及 VITE/NODE_ENV 构建配置一致；仅把准备流程迁到不同机器不会自动解决配置差异。配置不一致会拒绝上线，不回退绕过检查；需要在受控私有环境配置，禁止把凭据提交 Git 或放入公开 CI。产物只包含前后端输出、哈希和验收记录，不包含 dotenv、node_modules 或数据库备份。

1. 在构建机检出目标提交，安装环境后执行准备。产物父目录需已存在，目标目录必须不存在：

   ```bash
   SHA=$(git rev-parse HEAD)
   REPO_DIR="$PWD" DEPLOY_SKIP_GIT=1 DEPLOY_GIT_SHA="$SHA" \
     DEPLOY_PREPARE_ONLY=1 DEPLOY_ARTIFACT_DIR="/opt/inogi-release-out/$SHA" \
     DEPLOY_METRICS_DIR="$PWD/.deploy-cache/metrics" bash scripts/deploy.sh
   ```

   准备仍执行全部受影响的类型、脚本、API、契约及五组隔离数据库检查；全部通过才写 manifest。不会备份或迁移业务数据库，不访问 PM2、静态发布目录或线上健康地址，也不写“部署成功”快照。生产构建完成后生成产物，前端与 API 使用同一版本标识。

2. 使用现有受信任 SSH 通道，把整个目录传到服务器 `/opt/inogi-releases/<完整 SHA>`。先传到临时目录，传完再改成最终目录名；保留上一版目录。校验和用于发现传输损坏，不是签名；产物入口必须仅对受信任的构建账号/部署账号可写。

3. 同步安装新版 Git 钩子后，在服务器启用产物入口（只需一次）：

   ```bash
   printf '%s\n' /opt/inogi-releases > /opt/git/inogi-ai-office.git/hooks/artifact-root
   ```

   之后 push 或手动重试会选取该提交的产物。缺少产物会在检出前失败；提交、源码、配置、运行环境或文件校验不一致会在迁移/重启前失败。不会回退到生产机重新跑全量构建。生产仍按锁文件安装变化的依赖、校验原生模块、生成 Prisma Client，并按需备份/迁移，最后检查版本就绪再发布前端；依赖首次安装和数据库迁移耗时需单独统计。

4. 回退应用时使用保留的旧提交及其匹配产物重新发布，先确认当前数据库兼容旧代码。应用回退不会自动回退数据库。移除 `hooks/artifact-root` 可恢复默认源码发布流程；这不是部署动作，不会自动切换线上版本。

构建机尚未配置时，默认的重试复用、测试分组与编译复用仍可直接生效。线上切换 1–2 分钟是无迁移、依赖已安装场景的验收目标，并非当前测得结果。分别查看准备日志和上线日志，不能把移到构建机的耗时算成消失。

## 手动重试发布（复用钩子的锁和精确检出）

```bash
SHA=$(git --git-dir=/opt/git/inogi-ai-office.git rev-parse main)
printf '%s %s refs/heads/main\n' "$SHA" "$SHA" | /opt/git/inogi-ai-office.git/hooks/post-receive
```

可用环境变量：`DEPLOY_CHANGE_PLAN=0`（强制全量发布）、`DEPLOY_DB_BACKUP=0`（有 migration 时关闭备份）、`DEPLOY_RELOAD_NGINX=1`（显式重载 Nginx）、`WEB_ROOT`（前端发布目录）、`PM2_APP_NAME`、`DEPLOY_BACKUP_KEEP`、`DEPLOY_BACKUP_EXCLUDE_TABLE_DATA`（跳过行数据的表，空格分隔；置空则全量备份）、`DEPLOY_METRICS_ENABLED=0`（关闭基线记录）、`DEPLOY_METRICS_DIR`（默认 `/var/log/inogi-deploy`）。

服务器上的 `.env` 不纳入 Git，但内容参与质量检查及产物输入指纹。手动修改 `apps/api/.env` 后，请执行 `pm2 restart inogi-api --update-env`；如果还需要重新验证完整构建和测试，执行 `DEPLOY_CHANGE_PLAN=0 bash scripts/deploy.sh`。

## 数据库：备份与恢复

- **自动备份**：只有 migration 输入发生变化时才做。发布一开始就后台启动 `pg_dump` → `/opt/inogi-backups/`，与构建、测试并行；迁移前收口，失败则中止部署、不迁移。发布中途失败时后台 dump 会被终止，未完成的文件以 `.partial` 结尾并自动删除，不会留下能被误恢复的截断备份。
- **备份范围**：默认不导出 `ApiRequestLog` 的行数据 —— 这一张接口请求日志表占了整库 97.5%（7467MB / 7658MB），全量导出要 485 秒，而这份快照的用途只是「迁移出事能回滚业务数据」。表结构照常导出，恢复后该表存在但为空。要连日志一起备份就把 `DEPLOY_BACKUP_EXCLUDE_TABLE_DATA` 置空。
- **备份压缩**：装了 `pigz` 就按核数并行压（`dnf install -y pigz`，推荐：又快又比现在压得小），没装则退回 `gzip -1`。两者输出都是标准 `.gz`，恢复方式不变。`gzip -1` 的文件比过去的 `gzip -6` 大一两成，注意 `/opt` 余量与 `DEPLOY_BACKUP_KEEP`（默认保留 10 份）。
- **强制全量**：需要重新验证全部阶段时使用 `DEPLOY_CHANGE_PLAN=0 bash scripts/deploy.sh`。
- **恢复**（会覆盖现有数据，需输 yes 确认；注意 `ApiRequestLog` 会被恢复成空表）：
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
