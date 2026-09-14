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
# 发布基线只做观测，不参与发布成败判定。目录不可写或采样失败时会降级为普通文本日志。
DEPLOY_METRICS_ENABLED="${DEPLOY_METRICS_ENABLED:-1}"
DEPLOY_METRICS_DIR="${DEPLOY_METRICS_DIR:-/var/log/inogi-deploy}"
# 就绪检查从本机直连 API，重启后必须匹配当前发布版本。
DEPLOY_HEALTH_URL="${DEPLOY_HEALTH_URL:-http://127.0.0.1:${PORT:-3000}/api/health/ready}"
DEPLOY_HEALTH_TIMEOUT_SECONDS="${DEPLOY_HEALTH_TIMEOUT_SECONDS:-60}"

# 迁移前的保命快照默认不导出接口请求日志的行数据：这一张表占了整库 97.5%
# （7467MB / 7658MB），让备份要跑 485 秒，而快照的用途只是「迁移出事能回滚业务数据」。
# --exclude-table-data 只跳过行，表结构照常导出 —— 恢复后这张表存在但为空，
# restore.sh 无需改动。大小写敏感的表名必须带双引号，否则 pg_dump 会折成小写而匹配不上。
# 想连日志一起备份：把这个变量置空（DEPLOY_BACKUP_EXCLUDE_TABLE_DATA=）。
# 多张表用空格分隔。
DEPLOY_BACKUP_EXCLUDE_TABLE_DATA="${DEPLOY_BACKUP_EXCLUDE_TABLE_DATA-public.\"ApiRequestLog\"}"

# 变更感知默认开启。它只读取工作区内容并写入 .deploy-cache；任何异常都会保守退回全量发布。
DEPLOY_CHANGE_PLAN="${DEPLOY_CHANGE_PLAN:-1}"

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
# 前端构建内存上限：Node 默认堆 ~2GB，Univer/ExcelJS 等大依赖构建峰值会超而 OOM，统一抬到 4GB。
# 放在环境层 → 任何构建路径都生效（package.json 里也有同值的 --max-old-space-size 作双保险）。
export NODE_OPTIONS="--max-old-space-size=4096 ${NODE_OPTIONS:-}"
# package.json 里声明了 "packageManager": "pnpm@..."。若本机 corepack 已 enable 并垫了 npm，
# 它会因为「项目声明用 pnpm」而拒绝执行任何 npm 命令 —— 而本脚本的后端构建
# （npm --prefix apps/api run build）和质量闸门（npm test）两条分支都要用 npm。
# 关掉这个一致性检查，让 npm / pnpm 都能正常调用。未装 corepack 时该变量无副作用。
export COREPACK_ENABLE_STRICT=0

# ------------------------------- 工具 -------------------------------
ts() { date +"%Y-%m-%d %H:%M:%S"; }
log() { echo "[$(ts)] $*"; }

now_epoch_ms() {
  local value
  value="$(date +%s%3N 2>/dev/null || true)"
  case "$value" in
    ''|*[!0-9]*) printf '%s000' "$(date +%s)" ;;
    *) printf '%s' "$value" ;;
  esac
}

now_monotonic_ms() {
  if [ -r /proc/uptime ]; then
    awk '{ printf "%.0f", $1 * 1000; exit }' /proc/uptime 2>/dev/null || now_epoch_ms
  else
    now_epoch_ms
  fi
}

DEPLOY_STARTED_EPOCH_MS="$(now_epoch_ms)"
DEPLOY_STARTED_MONOTONIC_MS="$(now_monotonic_ms)"
DEPLOY_STARTED_EPOCH=$((DEPLOY_STARTED_EPOCH_MS / 1000))
DEPLOY_STARTED_AT="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
DEPLOY_COMPLETED=0
DEPLOY_FAILED_STAGE=""
DEPLOY_FAILURE_LINE=""
DEPLOY_CURRENT_STAGE=""
DEPLOY_STAGE_STARTED_EPOCH_MS=0
DEPLOY_STAGE_STARTED_MONOTONIC_MS=0
DEPLOY_METRICS_ACTIVE=0
DEPLOY_METRICS_FINALIZED=0
DEPLOY_METRICS_STAGE_FILE=""
DEPLOY_METRICS_RESOURCE_FILE=""
DEPLOY_METRICS_STOP_FILE=""
DEPLOY_METRICS_SAMPLER_PID=""
DEPLOY_PLAN_STATE_FILE=""
DEPLOY_PLAN_CANDIDATE_FILE=""
DEPLOY_PLAN_REASON="disabled"
DEPLOY_PLAN_DEPENDENCIES=1
DEPLOY_PLAN_FRONTEND=1
DEPLOY_PLAN_API=1
DEPLOY_PLAN_PRISMA=1
DEPLOY_PLAN_MIGRATIONS=1
DEPLOY_PLAN_QUALITY=1
DEPLOY_BACKUP_PID=""
DEPLOY_BACKUP_LOG=""
DEPLOY_BACKUP_STARTED_MONOTONIC_MS=0
DEPLOY_STAGE_NAMES=(
  checkout
  dependency_install
  frontend_build
  prisma_generate
  api_build
  typecheck
  tests
  database_backup
  database_migration
  api_restart
  api_readiness
  frontend_activate
  nginx_reload
)
# 已记录阶段的集合。macOS 自带的 bash 3.2 没有关联数组（declare -A 会直接报错，
# 连带 deploy-baseline 的用例在开发机上全部失败），这里改用空格分隔的字符串：
# 阶段名取自上面的固定清单，不含空格或通配符，前后留空格即可精确匹配。
DEPLOY_RECORDED_STAGES=" "

json_escape() {
  local value="${1-}"
  # JSON 不允许未转义控制字符；自由文本字段先去掉除 \t/\n/\r 外的 C0 控制字节。
  value="$(printf '%s' "$value" | LC_ALL=C tr -d '\001-\010\013\014\016-\037' 2>/dev/null || true)"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

init_deploy_metrics() {
  [ "$DEPLOY_METRICS_ENABLED" = "1" ] || {
    log "发布基线采集已禁用（DEPLOY_METRICS_ENABLED=${DEPLOY_METRICS_ENABLED}）。"
    return 0
  }

  if ! mkdir -p "$DEPLOY_METRICS_DIR" 2>/dev/null; then
    log "⚠️  发布基线目录不可创建：${DEPLOY_METRICS_DIR}；本次仅输出文本阶段耗时。"
    return 0
  fi

  DEPLOY_METRICS_STAGE_FILE="$(mktemp "$DEPLOY_METRICS_DIR/.stages.XXXXXX" 2>/dev/null || true)"
  DEPLOY_METRICS_RESOURCE_FILE="$(mktemp "$DEPLOY_METRICS_DIR/.resources.XXXXXX" 2>/dev/null || true)"
  DEPLOY_METRICS_STOP_FILE="${DEPLOY_METRICS_RESOURCE_FILE}.stop"
  if [ -z "$DEPLOY_METRICS_STAGE_FILE" ] || [ -z "$DEPLOY_METRICS_RESOURCE_FILE" ]; then
    log "⚠️  发布基线目录不可写：${DEPLOY_METRICS_DIR}；本次仅输出文本阶段耗时。"
    rm -f "$DEPLOY_METRICS_STAGE_FILE" "$DEPLOY_METRICS_RESOURCE_FILE" 2>/dev/null || true
    DEPLOY_METRICS_STAGE_FILE=""
    DEPLOY_METRICS_RESOURCE_FILE=""
    return 0
  fi

  rm -f "$DEPLOY_METRICS_STOP_FILE" 2>/dev/null || true
  DEPLOY_METRICS_ACTIVE=1
}

start_resource_sampler() {
  [ "$DEPLOY_METRICS_ACTIVE" = "1" ] || return 0
  [ -r /proc/stat ] && [ -r /proc/meminfo ] || {
    log "⚠️  当前系统没有可读的 /proc 资源指标；仍会记录发布阶段耗时。"
    return 0
  }

  (
    trap - ERR EXIT
    set +Eeuo pipefail
    previous_total=0
    previous_idle=0
    while [ ! -e "$DEPLOY_METRICS_STOP_FILE" ]; do
      cpu_values="$(awk '/^cpu / { idle=$5+$6; total=0; for (i=2; i<=NF; i++) total+=$i; print total, idle; exit }' /proc/stat 2>/dev/null)"
      memory_values="$(awk '/^MemTotal:/ { total=$2 } /^MemAvailable:/ { available=$2 } END { if (total && available) print total, total-available }' /proc/meminfo 2>/dev/null)"
      if [ -n "$cpu_values" ] && [ -n "$memory_values" ]; then
        read -r total idle <<EOF
$cpu_values
EOF
        read -r memory_total memory_used <<EOF
$memory_values
EOF
        cpu_busy=0
        if [ "$previous_total" -gt 0 ] && [ "$total" -gt "$previous_total" ]; then
          total_delta=$((total - previous_total))
          idle_delta=$((idle - previous_idle))
          cpu_busy=$((100 * (total_delta - idle_delta) / total_delta))
          [ "$cpu_busy" -lt 0 ] && cpu_busy=0
          [ "$cpu_busy" -gt 100 ] && cpu_busy=100
        fi
        printf '%s\t%s\t%s\t%s\n' "$(now_epoch_ms)" "$cpu_busy" "$memory_used" "$memory_total" \
          >> "$DEPLOY_METRICS_RESOURCE_FILE" 2>/dev/null || true
        previous_total="$total"
        previous_idle="$idle"
      fi
      sleep 1
    done
  ) &
  DEPLOY_METRICS_SAMPLER_PID=$!
}

stop_resource_sampler() {
  [ -n "$DEPLOY_METRICS_SAMPLER_PID" ] || return 0
  : > "$DEPLOY_METRICS_STOP_FILE" 2>/dev/null || true
  kill "$DEPLOY_METRICS_SAMPLER_PID" 2>/dev/null || true
  wait "$DEPLOY_METRICS_SAMPLER_PID" 2>/dev/null || true
  DEPLOY_METRICS_SAMPLER_PID=""
}

record_stage() {
  local stage_name="$1" stage_status="$2" started_epoch_ms="$3" ended_epoch_ms="$4" duration_ms="$5"
  local stage_peak_cpu=null stage_peak_memory=null stage_resource_samples=0
  [ "$DEPLOY_METRICS_ACTIVE" = "1" ] || return 0
  if [ -s "$DEPLOY_METRICS_RESOURCE_FILE" ]; then
    read -r stage_peak_cpu stage_peak_memory stage_resource_samples <<EOF
$(awk -F '\t' -v started="$started_epoch_ms" -v ended="$ended_epoch_ms" '
  $1 >= started && $1 <= ended {
    if ($2 > peak_cpu) peak_cpu=$2
    if ($3 > peak_memory) peak_memory=$3
    samples++
  }
  END { print peak_cpu+0, peak_memory+0, samples+0 }
' "$DEPLOY_METRICS_RESOURCE_FILE" 2>/dev/null)
EOF
    if [ "$stage_resource_samples" -eq 0 ]; then
      stage_peak_cpu=null
      stage_peak_memory=null
    fi
  fi
  if ! printf '{"name":"%s","status":"%s","started_epoch_ms":%s,"ended_epoch_ms":%s,"duration_ms":%s,"system_peak_cpu_percent":%s,"system_peak_memory_used_kb":%s,"resource_samples":%s}\n' \
    "$(json_escape "$stage_name")" "$(json_escape "$stage_status")" \
    "$started_epoch_ms" "$ended_epoch_ms" "$duration_ms" "$stage_peak_cpu" "$stage_peak_memory" "$stage_resource_samples" \
    >> "$DEPLOY_METRICS_STAGE_FILE" 2>/dev/null; then
    log "⚠️  阶段指标写入失败；部署继续执行。"
    return 0
  fi
  case "$DEPLOY_RECORDED_STAGES" in
    *" $stage_name "*) ;;
    *) DEPLOY_RECORDED_STAGES="${DEPLOY_RECORDED_STAGES}${stage_name} " ;;
  esac
}

record_missing_stages() {
  local stage_name now_ms
  [ "$DEPLOY_METRICS_ACTIVE" = "1" ] || return 0
  now_ms="$(now_epoch_ms)"
  for stage_name in "${DEPLOY_STAGE_NAMES[@]}"; do
    case "$DEPLOY_RECORDED_STAGES" in
      *" $stage_name "*) ;;
      *) record_stage "$stage_name" skipped "$now_ms" "$now_ms" 0 ;;
    esac
  done
}

start_stage() {
  local stage_name="$1"
  if [ -n "$DEPLOY_CURRENT_STAGE" ]; then
    log "⚠️  阶段 $DEPLOY_CURRENT_STAGE 未正常收口，按成功结束后继续记录 ${stage_name}。"
    finish_stage success
  fi
  DEPLOY_CURRENT_STAGE="$stage_name"
  DEPLOY_STAGE_STARTED_EPOCH_MS="$(now_epoch_ms)"
  DEPLOY_STAGE_STARTED_MONOTONIC_MS="$(now_monotonic_ms)"
  log "阶段[$stage_name] 开始。"
}

finish_stage() {
  local stage_status="${1:-success}" ended_epoch_ms ended_monotonic_ms duration_ms stage_name started_epoch_ms
  [ -n "$DEPLOY_CURRENT_STAGE" ] || return 0
  ended_epoch_ms="$(now_epoch_ms)"
  ended_monotonic_ms="$(now_monotonic_ms)"
  stage_name="$DEPLOY_CURRENT_STAGE"
  started_epoch_ms="$DEPLOY_STAGE_STARTED_EPOCH_MS"
  duration_ms=$((ended_monotonic_ms - DEPLOY_STAGE_STARTED_MONOTONIC_MS))
  if [ "$duration_ms" -lt 0 ]; then duration_ms=$((ended_epoch_ms - started_epoch_ms)); fi
  if [ "$duration_ms" -lt 0 ]; then duration_ms=0; fi
  record_stage "$stage_name" "$stage_status" "$started_epoch_ms" "$ended_epoch_ms" "$duration_ms"
  log "阶段[$stage_name] ${stage_status}，耗时 ${duration_ms}ms。"
  DEPLOY_CURRENT_STAGE=""
  DEPLOY_STAGE_STARTED_EPOCH_MS=0
  DEPLOY_STAGE_STARTED_MONOTONIC_MS=0
}

skip_stage() {
  local stage_name="$1"
  start_stage "$stage_name"
  finish_stage skipped
}

finalize_deploy_metrics() {
  local deploy_status="$1" exit_code="$2" ended_epoch_ms ended_monotonic_ms ended_at total_duration_ms total_duration_seconds
  local peak_cpu=null peak_memory=null memory_total=null resource_samples=0
  local release_name final_path temp_path node_version deploy_operator deploy_host deploy_trigger

  [ "$DEPLOY_METRICS_ACTIVE" = "1" ] || return 0
  [ "$DEPLOY_METRICS_FINALIZED" = "0" ] || return 0
  DEPLOY_METRICS_FINALIZED=1
  stop_resource_sampler
  record_missing_stages

  if [ -s "$DEPLOY_METRICS_RESOURCE_FILE" ]; then
    read -r peak_cpu peak_memory memory_total resource_samples <<EOF
$(awk -F '\t' '
  $2 > peak_cpu { peak_cpu=$2 }
  $3 > peak_memory { peak_memory=$3 }
  $4 > 0 { memory_total=$4 }
  { samples++ }
  END { print peak_cpu+0, peak_memory+0, memory_total+0, samples+0 }
' "$DEPLOY_METRICS_RESOURCE_FILE" 2>/dev/null)
EOF
    if [ "$resource_samples" -eq 0 ]; then
      peak_cpu=null
      peak_memory=null
      memory_total=null
    fi
  fi

  ended_epoch_ms="$(now_epoch_ms)"
  ended_monotonic_ms="$(now_monotonic_ms)"
  ended_at="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  total_duration_ms=$((ended_monotonic_ms - DEPLOY_STARTED_MONOTONIC_MS))
  if [ "$total_duration_ms" -lt 0 ]; then total_duration_ms=$((ended_epoch_ms - DEPLOY_STARTED_EPOCH_MS)); fi
  if [ "$total_duration_ms" -lt 0 ]; then total_duration_ms=0; fi
  total_duration_seconds=$((total_duration_ms / 1000))
  release_name="${RELEASE:-failed-$DEPLOY_STARTED_EPOCH-$$}"
  case "$release_name" in
    *[!a-zA-Z0-9._-]*|'') release_name="failed-$DEPLOY_STARTED_EPOCH-$$" ;;
  esac
  final_path="$DEPLOY_METRICS_DIR/$release_name-$$.json"
  temp_path="$(mktemp "$DEPLOY_METRICS_DIR/.result.XXXXXX" 2>/dev/null || true)"
  node_version="$(node --version 2>/dev/null || echo unknown)"
  deploy_operator="${DEPLOY_OPERATOR:-${SUDO_USER:-${USER:-unknown}}}"
  deploy_host="$(hostname 2>/dev/null || echo unknown)"
  if [ "${DEPLOY_SKIP_GIT:-0}" = "1" ]; then deploy_trigger="git-hook"; else deploy_trigger="manual"; fi

  if [ -z "$temp_path" ]; then
    log "⚠️  发布基线临时文件创建失败；部署结果不受影响。"
  elif ! {
    printf '{\n'
    printf '  "schema_version": 1,\n'
    printf '  "release": "%s",\n' "$(json_escape "${RELEASE:-unknown}")"
    printf '  "git_sha": "%s",\n' "$(json_escape "${GIT_SHA_FULL:-${GIT_SHA:-unknown}}")"
    printf '  "branch": "%s",\n' "$(json_escape "$BRANCH")"
    printf '  "operator": "%s",\n' "$(json_escape "$deploy_operator")"
    printf '  "host": "%s",\n' "$(json_escape "$deploy_host")"
    printf '  "trigger": "%s",\n' "$(json_escape "$deploy_trigger")"
    printf '  "node_version": "%s",\n' "$(json_escape "$node_version")"
    printf '  "status": "%s",\n' "$(json_escape "$deploy_status")"
    printf '  "exit_code": %s,\n' "$exit_code"
    printf '  "started_at": "%s",\n' "$(json_escape "$DEPLOY_STARTED_AT")"
    printf '  "ended_at": "%s",\n' "$(json_escape "$ended_at")"
    printf '  "duration_ms": %s,\n' "$total_duration_ms"
    printf '  "duration_seconds": %s,\n' "$total_duration_seconds"
    printf '  "failed_stage": "%s",\n' "$(json_escape "$DEPLOY_FAILED_STAGE")"
    printf '  "failed_line": "%s",\n' "$(json_escape "$DEPLOY_FAILURE_LINE")"
    printf '  "resource_scope": "system",\n'
    printf '  "system_peak_cpu_percent": %s,\n' "$peak_cpu"
    printf '  "system_peak_memory_used_kb": %s,\n' "$peak_memory"
    printf '  "system_memory_total_kb": %s,\n' "$memory_total"
    printf '  "resource_samples": %s,\n' "$resource_samples"
    printf '  "stages": [\n'
    awk 'NR == 1 { printf "    %s", $0; next } { printf ",\n    %s", $0 } END { if (NR > 0) printf "\n" }' \
      "$DEPLOY_METRICS_STAGE_FILE" 2>/dev/null || true
    printf '  ]\n'
    printf '}\n'
  } > "$temp_path" 2>/dev/null; then
    log "⚠️  发布基线 JSON 生成失败；部署结果不受影响。"
    rm -f "$temp_path" 2>/dev/null || true
  elif mv -f "$temp_path" "$final_path" 2>/dev/null; then
    chmod 0640 "$final_path" 2>/dev/null || true
    log "发布基线记录 → $final_path"
  else
    log "⚠️  发布基线 JSON 落盘失败；部署结果不受影响。"
    rm -f "$temp_path" 2>/dev/null || true
  fi

  rm -f "$DEPLOY_METRICS_STAGE_FILE" "$DEPLOY_METRICS_RESOURCE_FILE" "$DEPLOY_METRICS_STOP_FILE" \
    2>/dev/null || true
}

die() {
  DEPLOY_FAILED_STAGE="${DEPLOY_CURRENT_STAGE:-$DEPLOY_FAILED_STAGE}"
  DEPLOY_FAILURE_LINE="${BASH_LINENO[0]:-0}"
  echo "[$(ts)] ❌ ERROR: $*" >&2
  exit 1
}

on_deploy_error() {
  local exit_code="$1" failed_line="$2"
  DEPLOY_FAILED_STAGE="${DEPLOY_CURRENT_STAGE:-$DEPLOY_FAILED_STAGE}"
  DEPLOY_FAILURE_LINE="${DEPLOY_FAILURE_LINE:-$failed_line}"
  trap - ERR
  exit "$exit_code"
}

on_deploy_exit() {
  local exit_code="$1" deploy_status="failed"
  trap - ERR EXIT
  set +e
  cleanup_background_backup
  if [ "$exit_code" -eq 0 ] && [ "$DEPLOY_COMPLETED" = "1" ]; then
    deploy_status="success"
  fi
  if [ "$deploy_status" = "failed" ] && [ -z "$DEPLOY_FAILED_STAGE" ]; then
    DEPLOY_FAILED_STAGE="$DEPLOY_CURRENT_STAGE"
  fi
  if [ -n "$DEPLOY_CURRENT_STAGE" ]; then
    finish_stage "$deploy_status"
  fi
  finalize_deploy_metrics "$deploy_status" "$exit_code"
  if [ -n "$DEPLOY_PLAN_CANDIDATE_FILE" ]; then
    rm -f -- "$DEPLOY_PLAN_CANDIDATE_FILE" 2>/dev/null || true
  fi
  exit "$exit_code"
}

# 命令失败自动重试（最多 3 次）
retry() {
  local n=1 max=3
  until "$@"; do
    if [ "$n" -ge "$max" ]; then return 1; fi
    log "命令失败，第 $n/$((max-1)) 次重试：$*"
    n=$((n + 1)); sleep 3
  done
}

init_change_plan() {
  local planner_output key value
  [ "$DEPLOY_CHANGE_PLAN" = "1" ] || {
    log "变更感知已禁用（DEPLOY_CHANGE_PLAN=${DEPLOY_CHANGE_PLAN}），执行全量发布。"
    return 0
  }

  [ -f scripts/deploy-change-plan.mjs ] || {
    log "⚠️  缺少 scripts/deploy-change-plan.mjs，保守执行全量发布。"
    DEPLOY_PLAN_REASON="planner-missing"
    return 0
  }

  DEPLOY_PLAN_STATE_FILE="$CACHE_DIR/deploy-inputs.json"
  DEPLOY_PLAN_CANDIDATE_FILE="$(mktemp "$CACHE_DIR/.deploy-inputs.XXXXXX" 2>/dev/null || true)"
  [ -n "$DEPLOY_PLAN_CANDIDATE_FILE" ] || {
    log "⚠️  无法创建变更快照，保守执行全量发布。"
    DEPLOY_PLAN_REASON="snapshot-unavailable"
    return 0
  }

  if ! planner_output="$(node scripts/deploy-change-plan.mjs "$DEPLOY_PLAN_STATE_FILE" "$DEPLOY_PLAN_CANDIDATE_FILE")"; then
    log "⚠️  变更分类失败，保守执行全量发布。"
    DEPLOY_PLAN_REASON="planner-failed"
    rm -f -- "$DEPLOY_PLAN_CANDIDATE_FILE" 2>/dev/null || true
    DEPLOY_PLAN_CANDIDATE_FILE=""
    return 0
  fi

  while IFS='=' read -r key value; do
    case "$key" in
      DEPLOY_PLAN_REASON)
        case "$value" in first-release|deploy-logic-changed|incremental) DEPLOY_PLAN_REASON="$value" ;; esac
        ;;
      DEPLOY_PLAN_DEPENDENCIES|DEPLOY_PLAN_FRONTEND|DEPLOY_PLAN_API|DEPLOY_PLAN_PRISMA|DEPLOY_PLAN_MIGRATIONS|DEPLOY_PLAN_QUALITY)
        case "$value" in
          0|1) printf -v "$key" '%s' "$value" ;;
        esac
        ;;
    esac
  done <<EOF
$planner_output
EOF

  log "发布计划[$DEPLOY_PLAN_REASON]：dependencies=$DEPLOY_PLAN_DEPENDENCIES frontend=$DEPLOY_PLAN_FRONTEND api=$DEPLOY_PLAN_API prisma=$DEPLOY_PLAN_PRISMA migrations=$DEPLOY_PLAN_MIGRATIONS quality=$DEPLOY_PLAN_QUALITY"
}

commit_change_plan() {
  [ -n "$DEPLOY_PLAN_CANDIDATE_FILE" ] || return 0
  if mv -f -- "$DEPLOY_PLAN_CANDIDATE_FILE" "$DEPLOY_PLAN_STATE_FILE" 2>/dev/null; then
    DEPLOY_PLAN_CANDIDATE_FILE=""
    log "发布变更快照已更新。"
  else
    log "⚠️  发布已完成，但变更快照保存失败；下次将保守执行全量发布。"
  fi
}

# 从 apps/api/.env 读取 DATABASE_URL（不污染当前环境变量）
read_database_url() {
  [ -f apps/api/.env ] || return 0
  grep -E '^[[:space:]]*DATABASE_URL=' apps/api/.env 2>/dev/null | tail -n1 \
    | sed -E "s/^[[:space:]]*DATABASE_URL=//; s/^[\"']//; s/[\"']$//" || true
}

# 压缩是这条管道真正的瓶颈：实测 pg_dump 读完 7.5GB 只要 241s（user+sys 合计才 24s，
# 全程在等 I/O），而 gzip -6 单线程跟不上，把总时长拖到 467s。
# 有 pigz 就按核数并行压（输出仍是标准 .gz，restore.sh 的解压路径不用动）；
# 没有就退回 gzip -1 —— 文件大一两成，但压缩不再是瓶颈，总时长回落到读库速度。
compress_backup_stream() {
  if command -v pigz >/dev/null 2>&1; then
    pigz -p "$(nproc 2>/dev/null || echo 2)"
  else
    gzip -1
  fi
}

backup_file_path() {
  printf '%s/db-%s.sql.gz' "${DEPLOY_BACKUP_DIR:-/opt/inogi-backups}" "${RELEASE:-unknown}"
}

# 数据库备份：在「构建成功后、迁移前」调用。失败即中止，绝不在没有备份的情况下迁移。
# 自动探测：宿主机有 pg_dump 就直连导出（原生安装 / 云数据库均可）；
#           否则若数据库跑在 docker 容器里，则进容器导出；都没有则报错。
backup_database() {
  local url clean dir keep file partial container pattern
  local -a dump_args
  url="${DATABASE_URL:-$(read_database_url)}"
  [ -n "$url" ] || die "数据库备份失败：找不到 DATABASE_URL（apps/api/.env）。确实无需备份可设 DEPLOY_DB_BACKUP=0。"
  # 去掉 Prisma 特有的 ?schema=public 等查询参数，pg_dump(libpq) 不认识它们
  clean="${url%%\?*}"

  dir="${DEPLOY_BACKUP_DIR:-/opt/inogi-backups}"
  keep="${DEPLOY_BACKUP_KEEP:-10}"
  container="${POSTGRES_CONTAINER:-inogi-postgres}"
  mkdir -p "$dir"
  file="$(backup_file_path)"
  # 先写 .partial、成功后才改名：备份进程被中断时不会留下一个「看着正常、实际截断」
  # 的 .sql.gz，避免它日后被当成可用备份恢复。
  partial="$file.partial"

  dump_args=(--no-owner --no-acl --clean --if-exists)
  # 故意不加引号：按空格拆成多个排除模式。表名不含空格。
  for pattern in ${DEPLOY_BACKUP_EXCLUDE_TABLE_DATA-}; do
    dump_args+=(--exclude-table-data="$pattern")
    log "备份将跳过该表的行数据：$pattern"
  done

  log "备份数据库 → $file"
  if command -v pg_dump >/dev/null 2>&1; then
    pg_dump "${dump_args[@]}" "$clean" | compress_backup_stream > "$partial" \
      || { rm -f "$partial"; die "pg_dump 备份失败；已中止，不执行迁移。"; }
  elif command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$container"; then
    docker exec -i "$container" pg_dump "${dump_args[@]}" "$clean" | compress_backup_stream > "$partial" \
      || { rm -f "$partial"; die "docker pg_dump 备份失败；已中止，不执行迁移。"; }
  else
    die "数据库备份失败：宿主机没有 pg_dump，也没有运行中的 postgres 容器（${container}）。请安装 postgresql-client，或设 DEPLOY_DB_BACKUP=0 跳过（不推荐）。"
  fi

  [ -s "$partial" ] || { rm -f "$partial"; die "数据库备份文件为空；已中止。"; }
  mv -f "$partial" "$file" || { rm -f "$partial"; die "备份文件改名失败；已中止。"; }
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

# 备份只读数据库，与构建、测试互不依赖：发布计划一确定就后台启动，迁移前再收口。
# 这样它的耗时被构建/测试掩盖，而「没有备份绝不迁移」的保证一点没变。
# 代价：快照时间点比串行时提前几分钟 —— 数据库本来就在持续写入，这个差别没有实际意义。
start_background_backup() {
  [ "$DEPLOY_PLAN_MIGRATIONS" = "1" ] || return 0
  [ "${DEPLOY_DB_BACKUP:-1}" = "1" ] || return 0
  DEPLOY_BACKUP_LOG="$(mktemp "$CACHE_DIR/.db-backup.XXXXXX" 2>/dev/null || true)"
  [ -n "$DEPLOY_BACKUP_LOG" ] || {
    log "⚠️  无法创建备份日志文件；备份改为迁移前串行执行。"
    return 0
  }
  DEPLOY_BACKUP_STARTED_MONOTONIC_MS="$(now_monotonic_ms)"
  (
    # 子进程绝不能继承发布级 trap：否则它退出时会再写一份基线记录、并停掉采样器。
    trap - ERR EXIT
    backup_database
  ) > "$DEPLOY_BACKUP_LOG" 2>&1 &
  DEPLOY_BACKUP_PID=$!
  log "数据库备份已后台启动（PID ${DEPLOY_BACKUP_PID}），与构建、测试并行。"
}

wait_background_backup() {
  local status=0 background_ms=0
  wait "$DEPLOY_BACKUP_PID" || status=$?
  background_ms=$(( $(now_monotonic_ms) - DEPLOY_BACKUP_STARTED_MONOTONIC_MS ))
  [ "$background_ms" -ge 0 ] || background_ms=0
  DEPLOY_BACKUP_PID=""
  cat "$DEPLOY_BACKUP_LOG" 2>/dev/null || true
  rm -f -- "$DEPLOY_BACKUP_LOG" 2>/dev/null || true
  DEPLOY_BACKUP_LOG=""
  [ "$status" -eq 0 ] || die "数据库备份失败（后台任务退出码 ${status}）；已中止，不执行迁移。"
  log "后台备份合计耗时 ${background_ms}ms，其中绝大部分与构建、测试并行。"
}

# 发布在收口之前就失败时调用：正在跑的 dump 直接终止，半截的 .partial 一并清掉。
cleanup_background_backup() {
  if [ -n "$DEPLOY_BACKUP_PID" ]; then
    log "发布已中止，终止后台数据库备份（PID ${DEPLOY_BACKUP_PID}）。"
    kill "$DEPLOY_BACKUP_PID" 2>/dev/null || true
    wait "$DEPLOY_BACKUP_PID" 2>/dev/null || true
    DEPLOY_BACKUP_PID=""
    rm -f -- "$(backup_file_path).partial" 2>/dev/null || true
  fi
  if [ -n "$DEPLOY_BACKUP_LOG" ]; then
    cat "$DEPLOY_BACKUP_LOG" 2>/dev/null || true
    rm -f -- "$DEPLOY_BACKUP_LOG" 2>/dev/null || true
    DEPLOY_BACKUP_LOG=""
  fi
}

trap 'on_deploy_error "$?" "$LINENO"' ERR
trap 'on_deploy_exit "$?"' EXIT

init_deploy_metrics || true
start_resource_sampler || true
start_stage checkout || true

# ------------------------------ 0. 前置 ------------------------------
cd "$REPO_DIR" 2>/dev/null || die "找不到仓库目录 $REPO_DIR"

# ------------------------- 1. 获取代码 -------------------------
# 两种触发方式：
#   - 裸仓库 git 钩子调用：代码已被钩子检出，置 DEPLOY_SKIP_GIT=1，提交号由 DEPLOY_GIT_SHA 传入。
#   - 手动 / 远程拉取：从 origin fetch 并 reset --hard。
if [ "${DEPLOY_SKIP_GIT:-0}" = "1" ]; then
  log "钩子模式：代码已检出，跳过 git fetch。"
  if [ -n "${DEPLOY_GIT_SHA:-}" ]; then
    GIT_SHA_FULL="$DEPLOY_GIT_SHA"
    GIT_SHA="${GIT_SHA_FULL:0:7}"
  elif [ -d .git ]; then
    GIT_SHA_FULL="$(git rev-parse HEAD)"
    GIT_SHA="${GIT_SHA_FULL:0:7}"
  else
    GIT_SHA_FULL="unknown"
    GIT_SHA="unknown"
  fi
else
  [ -d .git ] || die "$REPO_DIR 不是 git 仓库；请先 git clone，或改用裸仓库钩子（DEPLOY_SKIP_GIT=1）。"
  log "拉取代码 origin/$BRANCH ..."
  retry git fetch --prune origin "$BRANCH" || die "git fetch 失败：确认服务器 origin 指向正确远程（git remote -v）"
  git reset --hard "origin/$BRANCH"
  GIT_SHA_FULL="$(git rev-parse HEAD)"
  GIT_SHA="${GIT_SHA_FULL:0:7}"
fi
RELEASE="$(date +%Y%m%d-%H%M%S)-$GIT_SHA"
log "本次发布 RELEASE=$RELEASE  GIT_SHA=$GIT_SHA"
finish_stage success || true

# --------------------------- 2. 包管理器 ---------------------------
start_stage dependency_install || true
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
init_change_plan
# 越早起越好：后面的依赖安装、构建、测试都在给它让出并行窗口。
start_background_backup
# 服务器（Linux）有 sha256sum，macOS 只有 shasum；两者算的是同一个 SHA-256，
# 输出格式也都是「哈希 + 空格 + 文件名」，所以回退不会改变服务器上已缓存的哈希值。
sha256_stdin() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum
  else
    shasum -a 256
  fi
}

lock_hash() {
  # 含 pnpm-workspace.yaml：onlyBuiltDependencies 等改动也应触发重新安装
  # `|| true`：pipefail 下，纯 pnpm 仓库缺 package-lock.json 会让 cat 返回非零而中断部署，这里容忍缺失文件
  { cat pnpm-workspace.yaml pnpm-lock.yaml package-lock.json apps/api/package-lock.json 2>/dev/null || true; } \
    | sha256_stdin | awk '{print $1}'
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
finish_stage success || true

# ----------------- 3. 构建前端（仅前端输入变化时）-----------------
# 统一用 npm run 而不是 pnpm：pnpm v11 在执行任何脚本前会先做一遍 lockfile
# 供应链校验（本仓库 1000+ 条目，实测约 90 秒且全程联网），依赖没变时纯属浪费，
# 还把部署成败绑到 registry 可用性上。npm run 只是执行脚本，没有这层开销。
# 依赖安装仍按第 2 步的 USE_PNPM 分支走 pnpm，此处只影响「怎么调用构建脚本」。
if [ "$DEPLOY_PLAN_FRONTEND" = "1" ]; then
  start_stage frontend_build || true
  log "构建前端 ..."
  VITE_APP_VERSION="$RELEASE" VITE_GIT_SHA="$GIT_SHA" retry npm run build
  finish_stage success || true
else
  log "前端输入未变化，跳过前端构建。"
  skip_stage frontend_build || true
fi

# ------------- 4. 生成 Prisma Client（必须在后端构建之前）-------------
# schema 或依赖变化时显式 generate；其余发布复用上次成功生成的 Client。
if [ "$DEPLOY_PLAN_PRISMA" = "1" ]; then
  start_stage prisma_generate || true
  log "Prisma schema 或依赖发生变化，生成 Prisma Client ..."
  ( cd apps/api && retry npx --no-install prisma generate )
  finish_stage success || true
else
  log "Prisma 输入未变化，跳过 Client 生成。"
  skip_stage prisma_generate || true
fi

# ---------------------------- 5. 构建后端 ----------------------------
if [ "$DEPLOY_PLAN_API" = "1" ]; then
  start_stage api_build || true
  log "构建后端 ..."
  retry npm --prefix apps/api run build
  finish_stage success || true
else
  log "API 输入未变化，跳过后端构建。"
  skip_stage api_build || true
fi

# --------------- 5.5 质量闸门（迁移与重启前的最后一道）---------------
# 位置很关键：此刻两端都已构建成功，但数据库还没备份/迁移、pm2 也还没重启，
# 所以在这里失败的回滚代价为零 —— 直接退出即可，线上仍跑着旧版本。
# 放在构建之后是因为测试用 ts-node 直接跑 TS，需要第 4 步生成的 Prisma Client。
# 不重试：测试失败是代码问题，重跑三次只会拖长部署时间。
# 紧急情况跳过：DEPLOY_RUN_TESTS=0（不推荐，写法与 DEPLOY_DB_BACKUP 一致）。
if [ "${DEPLOY_RUN_TESTS:-1}" = "1" ]; then
  # 一律用 npx --no-install 直接调本地 tsc，不走 `pnpm typecheck`：
  # pnpm v11 在执行脚本前会先跑一遍 lockfile 供应链校验（1000+ 条目、要联网），
  # 依赖没变时这纯属浪费，还把部署绑到 registry 可用性上。
  # 两端共用一个 typecheck 阶段：前端按前端输入决定，后端按 API/测试输入决定。
  # 后端这一遍是必要的：测试改用 transpile-only 之后，test/*.spec.ts 自身不再随测试
  # 被类型检查，改由这里一次 tsc 统一覆盖（比 50 个测试进程各查一遍便宜得多）。
  typecheck_frontend=0
  typecheck_api=0
  if [ "$DEPLOY_PLAN_FRONTEND" = "1" ]; then typecheck_frontend=1; fi
  if [ "$DEPLOY_PLAN_API" = "1" ] || [ "$DEPLOY_PLAN_QUALITY" = "1" ]; then typecheck_api=1; fi

  if [ "$typecheck_frontend" = "1" ] || [ "$typecheck_api" = "1" ]; then
    start_stage typecheck || true
    if [ "$typecheck_frontend" = "1" ]; then
      log "前端类型检查 ..."
      npx --no-install tsc --noEmit -p tsconfig.json \
        || die "前端类型检查未通过，已中止部署（线上仍是旧版本）。"
    else
      log "前端未变化，跳过前端类型检查。"
    fi
    if [ "$typecheck_api" = "1" ]; then
      log "后端类型检查（含 test/*.spec.ts）..."
      npx --no-install tsc --noEmit -p apps/api/tsconfig.json \
        --tsBuildInfoFile "$CACHE_DIR/tsbuildinfo-api" \
        || die "后端类型检查未通过，已中止部署（线上仍是旧版本）。"
    fi
    finish_stage success || true
  else
    log "前端与 API 输入均未变化，跳过类型检查。"
    skip_stage typecheck || true
  fi

  if [ "$DEPLOY_PLAN_API" = "1" ] || [ "$DEPLOY_PLAN_QUALITY" = "1" ]; then
    start_stage tests || true
    log "运行受影响的测试 ..."
    if [ "$DEPLOY_PLAN_QUALITY" = "1" ]; then
      npm run test:dev-scripts || die "开发脚本测试未通过，已中止部署（线上仍是旧版本）。"
    fi

    # test/*.spec.mts 用裸 node 直接 import 带 .ts 扩展名的源码，依赖 Node 的原生类型剥离。
    if node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit((a>23||(a===23&&b>=6)||(a===22&&b>=18))?0:1)'; then
      npm --prefix apps/api run test || die "测试未通过，已中止部署（线上仍是旧版本）。"
      log "质量闸门通过（API 全量测试）。"
    else
      npm --prefix apps/api run test:ts || die "测试未通过，已中止部署（线上仍是旧版本）。"
      log "⚠️  当前 Node $(node --version) 无原生 TS 加载能力，test/*.spec.mts 未运行。"
      log "质量闸门通过（API ts-node 套件）。"
    fi
    finish_stage success || true
  else
    log "API 与测试输入未变化，跳过测试。"
    skip_stage tests || true
  fi
else
  log "⚠️  已跳过类型检查与测试（DEPLOY_RUN_TESTS=0）。"
  skip_stage typecheck || true
  skip_stage tests || true
fi

# ----------------- 6. 数据库备份收口（仅 migration 变化时）-----------------
# 备份在第 2 步就已后台启动，这里只等它跑完：此刻构建已成功、数据库还没动，
# 备份失败则中止、不迁移。位置和保证与串行版本完全一致，只是耗时被前面的阶段掩盖了。
# 本阶段记录的耗时 = 还需要等待的时间，不是备份总耗时（总耗时另有一行文本日志）。
# 关掉自动备份：设 DEPLOY_DB_BACKUP=0（不推荐）。
if [ "$DEPLOY_PLAN_MIGRATIONS" != "1" ]; then
  log "数据库 migration 未变化，跳过备份。"
  skip_stage database_backup || true
elif [ -n "$DEPLOY_BACKUP_PID" ]; then
  start_stage database_backup || true
  log "等待后台数据库备份收口 ..."
  wait_background_backup
  finish_stage success || true
elif [ "${DEPLOY_DB_BACKUP:-1}" = "1" ]; then
  # 后台启动失败时的兜底：仍然串行备份，绝不静默跳过。
  start_stage database_backup || true
  backup_database
  finish_stage success || true
else
  log "已禁用自动备份（DEPLOY_DB_BACKUP=0），跳过。"
  skip_stage database_backup || true
fi

# ------------------- 7. 数据库迁移（自动更新 DB）-------------------
# 放在备份之后、重启之前：让「新代码 + 新表结构」尽量同时生效，
# 缩短旧代码碰到新表结构的时间窗口。
if [ "$DEPLOY_PLAN_MIGRATIONS" = "1" ]; then
  start_stage database_migration || true
  log "数据库 migration 发生变化，执行 prisma migrate deploy ..."
  ( cd apps/api && retry npx --no-install prisma migrate deploy )
  finish_stage success || true
else
  log "数据库 migration 未变化，跳过迁移命令。"
  skip_stage database_migration || true
fi

# ----------------- 8. 重启后端（注入运行期版本号）-----------------
if [ "$DEPLOY_PLAN_API" = "1" ]; then
  start_stage api_restart || true
  log "重启后端 pm2: $PM2_APP_NAME ..."
  if command -v pm2 >/dev/null 2>&1; then
    # ecosystem 的启动参数（node_args / max_memory_restart / exec_mode 等）只在进程「创建」
    # 时生效——pm2 restart --update-env 只重启并刷新环境变量，不会重载这些参数。所以按内容
    # 哈希判断 ecosystem 是否变更：没变 → 零停机 restart；变了（或首次/算不出哈希）→ delete
    # 后用 ecosystem 重新 start，确保新启动参数真正生效（否则改了内存墙也要手动重建，正是
    # 之前 OOM 迟迟压不住的原因）。哈希文件与依赖锁哈希同放 .deploy-cache，复用 sha256_stdin。
    PM2_ECO_FILE="deploy/pm2/ecosystem.config.cjs"
    PM2_ECO_HASH_FILE="$CACHE_DIR/pm2-ecosystem.sha"
    PM2_ECO_NEW_HASH="$({ cat "$PM2_ECO_FILE" 2>/dev/null || true; } | sha256_stdin | awk '{print $1}')"
    PM2_ECO_OLD_HASH="$(cat "$PM2_ECO_HASH_FILE" 2>/dev/null || echo none)"
    if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
      if [ -n "$PM2_ECO_NEW_HASH" ] && [ "$PM2_ECO_NEW_HASH" = "$PM2_ECO_OLD_HASH" ]; then
        # ecosystem 未变：复用已存在的进程定义（保留 cwd / .env 加载方式），只更新环境变量与代码
        APP_VERSION="$RELEASE" APP_GIT_SHA="$GIT_SHA" \
          pm2 restart "$PM2_APP_NAME" --update-env
      else
        log "检测到 pm2 ecosystem 配置变更，重建进程以应用新启动参数（node_args / max_memory_restart）..."
        pm2 delete "$PM2_APP_NAME" >/dev/null 2>&1 || true
        APP_VERSION="$RELEASE" APP_GIT_SHA="$GIT_SHA" \
          pm2 start "$PM2_ECO_FILE" --update-env
      fi
    else
      log "pm2 进程 $PM2_APP_NAME 不存在，用 ecosystem 首次启动 ..."
      APP_VERSION="$RELEASE" APP_GIT_SHA="$GIT_SHA" \
        pm2 start "$PM2_ECO_FILE" --update-env
    fi
    # 记录本次生效的 ecosystem 哈希，供下次比对（写失败不影响部署）
    if [ -n "$PM2_ECO_NEW_HASH" ]; then
      printf '%s\n' "$PM2_ECO_NEW_HASH" > "$PM2_ECO_HASH_FILE" 2>/dev/null || true
    fi
    pm2 save >/dev/null 2>&1 || true
  else
    die "未找到 pm2，请先安装：npm i -g pm2"
  fi
  finish_stage success || true
else
  log "API 未变化，跳过 PM2 重启。"
  skip_stage api_restart || true
fi

# ----------------- 9. 确认后端与数据库就绪，再发布前端 -----------------
wait_for_api_readiness() {
  local deadline response expected_sha="" expected_release=""
  case "$DEPLOY_HEALTH_TIMEOUT_SECONDS" in
    ''|*[!0-9]*) die "就绪检查等待时间必须是正整数秒" ;;
  esac
  [ "$DEPLOY_HEALTH_TIMEOUT_SECONDS" -ge 1 ] && [ "$DEPLOY_HEALTH_TIMEOUT_SECONDS" -le 300 ] \
    || die "就绪检查等待时间必须在 1 至 300 秒之间"
  command -v curl >/dev/null 2>&1 || die "缺少 curl，无法执行部署就绪检查"
  if [ "$DEPLOY_PLAN_API" = "1" ]; then
    expected_sha="$GIT_SHA"
    expected_release="$RELEASE"
  fi
  deadline=$((SECONDS + DEPLOY_HEALTH_TIMEOUT_SECONDS))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if response="$(curl --silent --show-error --fail --connect-timeout 2 --max-time 5 "$DEPLOY_HEALTH_URL" 2>/dev/null)"; then
      if EXPECTED_API_SHA="$expected_sha" EXPECTED_API_RELEASE="$expected_release" node -e '
        try {
          const body = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
          const ready = body.ok === true && body.database === "ready"
            && (!process.env.EXPECTED_API_SHA || body.git_sha === process.env.EXPECTED_API_SHA)
            && (!process.env.EXPECTED_API_RELEASE || body.release === process.env.EXPECTED_API_RELEASE);
          process.exit(ready ? 0 : 1);
        } catch { process.exit(1); }
      ' <<< "$response"; then
        return 0
      fi
    fi
    sleep 1
  done
  return 1
}

if [ "$DEPLOY_PLAN_API" = "1" ] || [ "$DEPLOY_PLAN_FRONTEND" = "1" ] || [ "$DEPLOY_PLAN_MIGRATIONS" = "1" ]; then
  start_stage api_readiness || true
  log "等待 API、数据库与发布版本就绪 ..."
  wait_for_api_readiness || die "API 就绪检查失败，未发布前端，也未记录部署成功；请检查后端启动和数据库连接。"
  finish_stage success || true
else
  skip_stage api_readiness || true
fi

if [ "$DEPLOY_PLAN_FRONTEND" != "1" ]; then
  log "前端未变化，跳过静态文件发布。"
  skip_stage frontend_activate || true
elif [ -d "$WEB_ROOT" ]; then
  start_stage frontend_activate || true
  log "发布前端 dist → $WEB_ROOT ..."
  printf '{"release":"%s","git_sha":"%s"}\n' "$RELEASE" "$GIT_SHA" > "$REPO_DIR/dist/version.json"
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete-after "$REPO_DIR/dist/" "$WEB_ROOT/"
  else
    cp -a "$REPO_DIR/dist/." "$WEB_ROOT/"
  fi
  finish_stage success || true
else
  die "前端发布目录不存在：${WEB_ROOT}（请确认 nginx root 或设置 WEB_ROOT）"
fi

# ---------------------------- 10. nginx ----------------------------
if [ "${DEPLOY_RELOAD_NGINX:-0}" != "1" ]; then
  log "Nginx 配置未由本次发布变更，跳过 reload。"
  skip_stage nginx_reload || true
elif command -v nginx >/dev/null 2>&1; then
  start_stage nginx_reload || true
  log "重载 nginx ..."
  if nginx -t >/dev/null 2>&1; then
    nginx_reload_status=success
    nginx -s reload || { log "⚠️  nginx reload 失败（请手动检查）"; nginx_reload_status=warning; }
    finish_stage "$nginx_reload_status" || true
  else
    log "⚠️  nginx 配置测试未通过，跳过 reload（运行 nginx -t 查看原因）"
    finish_stage skipped || true
  fi
else
  skip_stage nginx_reload || true
fi

commit_change_plan
DEPLOY_COMPLETED=1
log "✅ 部署完成  RELEASE=$RELEASE"
