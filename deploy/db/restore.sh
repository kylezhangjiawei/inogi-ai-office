#!/usr/bin/env bash
#
# 从备份恢复数据库（与 scripts/deploy.sh 的自动备份配套）。
#
# 用法：
#   bash deploy/db/restore.sh /opt/inogi-backups/db-20260530-153000-abc1234.sql.gz
#
# 自动探测：宿主机有 psql 就直连恢复；否则若数据库在 docker 容器里则进容器恢复。
# ⚠️ 恢复会覆盖现有数据库内容，执行前需要手动输入 yes 确认。
set -Eeuo pipefail

FILE="${1:-}"
if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "用法：bash deploy/db/restore.sh <备份文件.sql.gz>"
  echo "可用备份："
  # 文件名为受控格式，ls 安全
  # shellcheck disable=SC2012
  ls -1t "${DEPLOY_BACKUP_DIR:-/opt/inogi-backups}"/db-*.sql.gz 2>/dev/null | head || echo "  （未找到备份）"
  exit 1
fi

REPO_DIR="${REPO_DIR:-/opt/inogi-ai-office-system}"
cd "$REPO_DIR" 2>/dev/null || { echo "找不到仓库目录 $REPO_DIR"; exit 1; }

# 读取 DATABASE_URL
url="${DATABASE_URL:-$(grep -E '^[[:space:]]*DATABASE_URL=' apps/api/.env 2>/dev/null | tail -n1 | sed -E "s/^[[:space:]]*DATABASE_URL=//; s/^[\"']//; s/[\"']$//" || true)}"
[ -n "$url" ] || { echo "找不到 DATABASE_URL（apps/api/.env）"; exit 1; }
clean="${url%%\?*}"
container="${POSTGRES_CONTAINER:-inogi-postgres}"

echo "⚠️  即将用备份覆盖数据库（现有数据会被替换）："
echo "    备份文件：$FILE"
# 打印目标库但隐藏账号密码（把 ://user:pass@ 显示成 ://***@，贪婪匹配到最后一个 @）
echo "    目标库  ：$(printf '%s' "$clean" | sed -E 's#://[^/]*@#://***@#')"
read -r -p "确认请输入 yes： " ans
[ "$ans" = "yes" ] || { echo "已取消。"; exit 1; }

echo "恢复中 ..."
if command -v psql >/dev/null 2>&1; then
  gunzip -c "$FILE" | psql -v ON_ERROR_STOP=1 "$clean"
elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$container"; then
  gunzip -c "$FILE" | docker exec -i "$container" psql -v ON_ERROR_STOP=1 "$clean"
else
  echo "找不到 psql，也没有运行中的 postgres 容器（$container）。请安装 postgresql-client。"
  exit 1
fi

echo "✅ 恢复完成。建议随后重启后端：pm2 restart inogi-api"
