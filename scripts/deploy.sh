#!/usr/bin/env bash
#
# 部署主脚本 —— 在阿里云服务器上执行（幂等 / 失败即停 / 有日志）。
#
# 用法：
#   手动：  bash scripts/deploy.sh
#   自动：  由 deploy/webhook/server.mjs 在收到 Gitee push 后调用
#
# 它做的事（对应三个痛点）：
#   1) 从 Gitee 拉代码（避免 git timeout，前提是服务器 origin 指向 Gitee）
#   2) 走国内镜像 + 增量安装依赖（避免 npm/prisma 拉包超时）
#   3) 构建前端时注入版本号、重启后端时注入同一版本号 →
#      让前端能检测到「有新版本」并提示用户刷新；同时 nginx 不缓存 index.html
#   并自动执行数据库迁移 prisma migrate deploy。
#
# 可用环境变量覆盖默认值（见下方）。
set -Eeuo pipefail

# ----------------------------- 可配置项 -----------------------------
REPO_DIR="${REPO_DIR:-/opt/inogi-ai-office-system}"
BRANCH="${DEPLOY_BRANCH:-main}"
PM2_APP_NAME="${PM2_APP_NAME:-inogi-api}"
# nginx 实际服务的前端目录（root 指向这里）。构建产物在 dist/，部署时同步到此目录。
WEB_ROOT="${WEB_ROOT:-/usr/share/nginx/html/weoxy-test}"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
PRISMA_MIRROR="${PRISMA_ENGINES_MIRROR:-https://registry.npmmirror.com/-/binary/prisma}"

# ------------------------- 国内镜像（防超时）-------------------------
# npm / pnpm 包源
export npm_config_registry="$NPM_REGISTRY"
# prisma 引擎二进制（prisma generate / migrate 不再去海外 CDN）
export PRISMA_ENGINES_MIRROR="$PRISMA_MIRROR"
export npm_config_prisma_engines_mirror="$PRISMA_MIRROR"
# node-gyp / 常见原生包预编译二进制
export NODEJS_ORG_MIRROR="https://registry.npmmirror.com/-/binary/node"
export NVM_NODEJS_ORG_MIRROR="https://registry.npmmirror.com/-/binary/node"
export SHARP_BINARY_HOST="https://registry.npmmirror.com/-/binary/sharp"
export SHARP_LIBVIPS_BINARY_HOST="https://registry.npmmirror.com/-/binary/sharp-libvips"

# ------------------------------- 工具 -------------------------------
ts() { date +"%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(ts)] $*"; }
die() { echo "[$(ts)] ❌ ERROR: $*" >&2; exit 1; }

# 命令失败自动重试（最多 3 次）
retry() {
  local n=1 max=3
  until "$@"; do
    if [ "$n" -ge "$max" ]; then return 1; fi
    log "命令失败，第 $n/$((max-1)) 次重试：$*"
    n=$((n + 1)); sleep 3
  done
}

# 从 apps/api/.env 读取 DATABASE_URL（不污染当前环境变量）
read_database_url() {
  [ -f apps/api/.env ] || return 0
  grep -E '^[[:space:]]*DATABASE_URL=' apps/api/.env 2>/dev/null | tail -n1 \
    | sed -E "s/^[[:space:]]*DATABASE_URL=//; s/^[\"']//; s/[\"']$//" || true
}

# 数据库备份：在「构建成功后、迁移前」调用。失败即中止，绝不在没有备份的情况下迁移。
# 自动探测：宿主机有 pg_dump 就直连导出（原生安装 / 云数据库均可）；
#           否则若数据库跑在 docker 容器里，则进容器导出；都没有则报错。
backup_database() {
  local url clean dir keep file container
  url="${DATABASE_URL:-$(read_database_url)}"
  [ -n "$url" ] || die "数据库备份失败：找不到 DATABASE_URL（apps/api/.env）。确实无需备份可设 DEPLOY_DB_BACKUP=0。"
  # 去掉 Prisma 特有的 ?schema=public 等查询参数，pg_dump(libpq) 不认识它们
  clean="${url%%\?*}"

  dir="${DEPLOY_BACKUP_DIR:-/opt/inogi-backups}"
  keep="${DEPLOY_BACKUP_KEEP:-10}"
  container="${POSTGRES_CONTAINER:-inogi-postgres}"
  mkdir -p "$dir"
  file="$dir/db-$RELEASE.sql.gz"

  log "备份数据库 → $file"
  if command -v pg_dump >/dev/null 2>&1; then
    pg_dump --no-owner --no-acl --clean --if-exists "$clean" | gzip > "$file" \
      || { rm -f "$file"; die "pg_dump 备份失败；已中止，不执行迁移。"; }
  elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$container"; then
    docker exec -i "$container" pg_dump --no-owner --no-acl --clean --if-exists "$clean" | gzip > "$file" \
      || { rm -f "$file"; die "docker pg_dump 备份失败；已中止，不执行迁移。"; }
  else
    die "数据库备份失败：宿主机没有 pg_dump，也没有运行中的 postgres 容器（$container）。请安装 postgresql-client，或设 DEPLOY_DB_BACKUP=0 跳过（不推荐）。"
  fi

  [ -s "$file" ] || { rm -f "$file"; die "数据库备份文件为空；已中止。"; }
  log "备份完成：$(du -h "$file" 2>/dev/null | awk '{print $1}')  $file"

  # 轮转：只保留最近 keep 份，更早的删除（无匹配时安全跳过，避免触发 set -e）
  if ls "$dir"/db-*.sql.gz >/dev/null 2>&1; then
    # 文件名为受控格式 db-<时间>-<sha>.sql.gz，无特殊字符，ls 安全
    # shellcheck disable=SC2012
    ls -1t "$dir"/db-*.sql.gz | tail -n +"$((keep + 1))" | while read -r old; do
      log "清理旧备份：$old"; rm -f "$old"
    done
  fi
}

trap 'die "部署在第 $LINENO 行中断"' ERR

# ------------------------------ 0. 前置 ------------------------------
cd "$REPO_DIR" 2>/dev/null || die "找不到仓库目录 $REPO_DIR"

# ------------------------- 1. 获取代码 -------------------------
# 两种触发方式：
#   - 裸仓库 git 钩子调用：代码已被钩子检出，置 DEPLOY_SKIP_GIT=1，提交号由 DEPLOY_GIT_SHA 传入。
#   - 手动 / 远程拉取：从 origin fetch 并 reset --hard。
if [ "${DEPLOY_SKIP_GIT:-0}" = "1" ]; then
  log "钩子模式：代码已检出，跳过 git fetch。"
  if [ -n "${DEPLOY_GIT_SHA:-}" ]; then
    GIT_SHA="${DEPLOY_GIT_SHA:0:7}"
  elif [ -d .git ]; then
    GIT_SHA="$(git rev-parse --short HEAD)"
  else
    GIT_SHA="unknown"
  fi
else
  [ -d .git ] || die "$REPO_DIR 不是 git 仓库；请先 git clone，或改用裸仓库钩子（DEPLOY_SKIP_GIT=1）。"
  log "拉取代码 origin/$BRANCH ..."
  retry git fetch --prune origin "$BRANCH" || die "git fetch 失败：确认服务器 origin 指向正确远程（git remote -v）"
  git reset --hard "origin/$BRANCH"
  GIT_SHA="$(git rev-parse --short HEAD)"
fi
RELEASE="$(date +%Y%m%d-%H%M%S)-$GIT_SHA"
log "本次发布 RELEASE=$RELEASE  GIT_SHA=$GIT_SHA"

# --------------------------- 2. 包管理器 ---------------------------
USE_PNPM=0
if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then
  USE_PNPM=1
  log "使用 pnpm（检测到 pnpm-lock.yaml）"
else
  log "使用 npm"
fi

# 增量安装：lockfile 内容没变就跳过安装
CACHE_DIR="$REPO_DIR/.deploy-cache"
mkdir -p "$CACHE_DIR"
lock_hash() {
  # 含 pnpm-workspace.yaml：onlyBuiltDependencies 等改动也应触发重新安装
  cat pnpm-workspace.yaml pnpm-lock.yaml package-lock.json apps/api/package-lock.json 2>/dev/null \
    | sha256sum | awk '{print $1}'
}
NEW_HASH="$(lock_hash)"
OLD_HASH="$(cat "$CACHE_DIR/lock.sha" 2>/dev/null || echo none)"

install_deps() {
  if [ "$USE_PNPM" = "1" ]; then
    # --prod=false 确保装上 vite / nest-cli / prisma 等 devDependencies（构建必须）
    retry pnpm install --frozen-lockfile --prod=false --prefer-offline \
      || retry pnpm install --prod=false --prefer-offline
  else
    retry npm install --include=dev --no-audit --no-fund
    retry npm install --prefix apps/api --include=dev --no-audit --no-fund
  fi
}

# argon2 是原生模块：它的预编译二进制要求的 glibc 版本可能高于本机
# （会导致 ERR_DLOPEN_FAILED → 后端启动即崩溃 → 全站 502）。
# 这里检测能否加载，不能就在本机从源码编译，匹配本机 glibc。幂等：能加载就直接跳过。
# 前置（一次性）：服务器需有 gcc/gcc-c++/make、Python ≥3.8、node-gyp。
ensure_native_argon2() {
  local dir py
  dir="$(find node_modules/.pnpm -type d -path '*/argon2@*/node_modules/argon2' 2>/dev/null | head -1)"
  [ -n "$dir" ] || return 0
  if ( cd "$dir" && node -e "require('.')" ) >/dev/null 2>&1; then
    log "argon2 原生模块加载正常。"
    return 0
  fi
  log "argon2 预编译与本机不兼容，改为从源码编译 ..."
  py="$(command -v python3.11 || command -v python3.9 || command -v python3.8 || command -v python3 || true)"
  [ -n "$py" ] || die "未找到 Python（node-gyp 需 ≥3.8）；请先 dnf install -y python3.11。"
  command -v node-gyp >/dev/null 2>&1 || npm install -g node-gyp --registry="$NPM_REGISTRY" >/dev/null 2>&1 || true
  ( cd "$dir" && rm -rf prebuilds build && node-gyp rebuild --python "$py" ) \
    || die "argon2 源码编译失败；请检查 gcc/gcc-c++/make 与 Python ≥3.8。"
  ( cd "$dir" && node -e "require('.')" ) >/dev/null 2>&1 \
    || die "argon2 编译后仍无法加载。"
  log "argon2 已从源码编译并可正常加载。"
}

if [ "$NEW_HASH" = "$OLD_HASH" ] && [ -d node_modules ]; then
  log "依赖 lockfile 未变化，跳过安装。"
else
  log "安装依赖（首次或依赖有变动）..."
  install_deps
  echo "$NEW_HASH" > "$CACHE_DIR/lock.sha"
fi

# 2.5 确保 argon2 原生模块在本机可加载（否则后端崩溃 → 502）。即使跳过安装也校验。
ensure_native_argon2

# ----------------- 3. 构建前端（注入版本，痛点3关键）-----------------
log "构建前端 ..."
if [ "$USE_PNPM" = "1" ]; then
  VITE_APP_VERSION="$RELEASE" VITE_GIT_SHA="$GIT_SHA" retry pnpm build
else
  VITE_APP_VERSION="$RELEASE" VITE_GIT_SHA="$GIT_SHA" retry npm run build
fi

# ------------- 4. 生成 Prisma Client（必须在后端构建之前）-------------
# 关键：schema 变更不会改动 lockfile，第 2 步的增量安装会跳过 @prisma/client
# 的 postinstall，导致已生成的 client 过期、后端 tsc 编译大量报错。所以这里
# 每次都显式 generate，确保类型与当前 schema 一致。
log "生成 Prisma Client ..."
( cd apps/api && retry npx --no-install prisma generate )

# ---------------------------- 5. 构建后端 ----------------------------
log "构建后端 ..."
retry npm --prefix apps/api run build

# ----------------- 6. 数据库备份（迁移前的安全闸门）-----------------
# 此刻构建已成功、数据库还没动 —— 自动备份整库；备份失败则中止、不迁移。
# 关掉自动备份：设 DEPLOY_DB_BACKUP=0（不推荐）。
if [ "${DEPLOY_DB_BACKUP:-1}" = "1" ]; then
  backup_database
else
  log "已禁用自动备份（DEPLOY_DB_BACKUP=0），跳过。"
fi

# ------------------- 7. 数据库迁移（自动更新 DB）-------------------
# 放在备份之后、重启之前：让「新代码 + 新表结构」尽量同时生效，
# 缩短旧代码碰到新表结构的时间窗口。
log "数据库迁移 prisma migrate deploy ..."
( cd apps/api && retry npx --no-install prisma migrate deploy )

# ----------------- 8. 发布前端到 nginx 目录 -----------------
# nginx 的 root 指向 WEB_ROOT，构建产物却在 dist/；这里把 dist 同步过去，
# 前端改动才真正上线。放在重启前，使前后端版本尽量同时生效（减少版本提示误弹）。
if [ -d "$WEB_ROOT" ]; then
  log "发布前端 dist → $WEB_ROOT ..."
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete-after "$REPO_DIR/dist/" "$WEB_ROOT/"
  else
    cp -a "$REPO_DIR/dist/." "$WEB_ROOT/"
  fi
else
  log "⚠️  前端发布目录不存在：$WEB_ROOT，跳过发布（请确认 nginx root 或设 WEB_ROOT）"
fi

# ----------------- 9. 重启后端（注入运行期版本号）-----------------
log "重启后端 pm2: $PM2_APP_NAME ..."
if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
    # 复用已存在的进程定义（保留其 cwd / .env 加载方式），只更新环境变量与代码
    APP_VERSION="$RELEASE" APP_GIT_SHA="$GIT_SHA" \
      pm2 restart "$PM2_APP_NAME" --update-env
  else
    log "pm2 进程 $PM2_APP_NAME 不存在，用 ecosystem 首次启动 ..."
    APP_VERSION="$RELEASE" APP_GIT_SHA="$GIT_SHA" \
      pm2 start deploy/pm2/ecosystem.config.cjs --update-env
  fi
  pm2 save >/dev/null 2>&1 || true
else
  die "未找到 pm2，请先安装：npm i -g pm2"
fi

# ---------------------------- 10. nginx ----------------------------
if command -v nginx >/dev/null 2>&1; then
  log "重载 nginx ..."
  if nginx -t >/dev/null 2>&1; then
    nginx -s reload || log "⚠️  nginx reload 失败（请手动检查）"
  else
    log "⚠️  nginx 配置测试未通过，跳过 reload（运行 nginx -t 查看原因）"
  fi
fi

trap - ERR
log "✅ 部署完成  RELEASE=$RELEASE"
