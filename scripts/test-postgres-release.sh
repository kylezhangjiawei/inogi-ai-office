#!/usr/bin/env bash
# Reuse the five socket-only database runners; never inherit deployment credentials.
set -Eeuo pipefail

fail() { printf 'Isolated PostgreSQL gate failed: %s\n' "$*" >&2; exit 1; }
test "$(uname -s)" = Linux || fail 'Linux is required for the release database gate.'
command -v setsid >/dev/null || fail 'setsid is required to isolate database runners from terminal signals.'
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
api_root="$repo_root/apps/api"
caller_uid="$(id -u)"
test_uid="$caller_uid"
if test "$caller_uid" = 0; then
  command -v runuser >/dev/null || fail 'runuser is required to run initdb as nobody.'
  test_uid="$(id -u nobody)" || fail 'The existing nobody account is required.'
fi
[[ "$test_uid" =~ ^[0-9]+$ ]] && test "$test_uid" != 0 || fail 'A non-root test identity is required.'

# Existing tests deliberately accept only these socket prefixes. Do not chmod or
# take ownership of an existing directory to make an unsafe installation pass.
for directory in /private /private/tmp; do
  test ! -L "$directory" || fail "Temporary path is a symlink: $directory"
  if test ! -e "$directory"; then
    test "$caller_uid" = 0 || fail "Missing $directory; an administrator must prepare the test directory."
    if test "$directory" = /private; then mkdir -m 0755 -- "$directory";
    else mkdir -m 1777 -- "$directory"; fi
  fi
  test -d "$directory" || fail "Temporary path is not a directory: $directory"
  metadata="$(stat -c '%u:%a' -- "$directory")"
  owner="${metadata%%:*}"
  mode="${metadata#*:}"
  test "$owner" = 0 || fail "Temporary directory must be root-owned: $directory"
  [[ "$mode" =~ ^[0-7]{3,4}$ ]] || fail "Cannot validate permissions: $directory"
  if test "$directory" = /private; then
    (( (8#$mode & 0022) == 0 )) || fail '/private must not be writable by group or others.'
  else
    test "$mode" = 1777 || fail '/private/tmp must already have sticky temporary-directory permissions (1777).'
  fi
done

node_bin="$(command -v node)" || fail 'Node is required.'
if pg_config_bin="$(command -v pg_config)"; then
  pg_bin="$("$pg_config_bin" --bindir)" || fail 'Cannot locate PostgreSQL binaries.'
else
  initdb_bin="$(command -v initdb)" || fail 'PostgreSQL initdb is required (pg_config is also unavailable).'
  pg_bin="$(dirname -- "$initdb_bin")"
fi
for tool in initdb pg_ctl createdb psql; do
  test -x "$pg_bin/$tool" || fail "Missing PostgreSQL executable: $tool"
done
clean_path="$(dirname -- "$node_bin"):$pg_bin:/usr/bin:/bin"
work_root="$(mktemp -d /private/tmp/inogi-release-pg.XXXXXX)"
trap 'rm -rf -- "$work_root"' EXIT
cancel_status=0
request_cancel() {
  if test "$cancel_status" = 0; then
    cancel_status="$1"
    printf 'Cancellation requested; waiting for the current isolated runner to finish database cleanup.\n' >&2
  fi
}
trap 'request_cancel 130' INT
trap 'request_cancel 143' TERM
mkdir -m 0700 -- "$work_root/home"
if test "$caller_uid" = 0; then
  # Keep parent-owned logs outside the writable test HOME; the test identity must
  # not be able to replace a later root-written log with a symlink.
  chown "$test_uid" -- "$work_root/home"
  chmod 0711 -- "$work_root"
fi
identity=()
if test "$caller_uid" = 0; then identity=(runuser -u nobody --); fi
test_command=(setsid --wait "${identity[@]}" env -i PATH="$clean_path" HOME="$work_root/home" TMPDIR="$work_root/home"
  LANG=C.UTF-8 NODE_OPTIONS=--test-reporter=tap CHECKPOINT_DISABLE=1 PRISMA_HIDE_UPDATE_MESSAGE=1
  APPLICANT_FORMS_TEST_PG_BIN="$pg_bin" AUDIT_RECEIPTS_TEST_PG_BIN="$pg_bin"
  CHAT_TEST_PG_BIN="$pg_bin" PROC_ROLLBACK_TEST_PG_BIN="$pg_bin" RD_DOCUMENTS_TEST_PG_BIN="$pg_bin")

cd -- "$api_root"
"${test_command[@]}" "$node_bin" -e '
const fs = require("node:fs");
for (const path of ["prisma/schema.prisma", "test", "src", "node_modules/ts-node/register/index.js", "node_modules/prisma/build/index.js"]) fs.accessSync(path, fs.constants.R_OK);
for (const path of process.argv.slice(1)) fs.accessSync(path, fs.constants.X_OK);
' "$pg_bin/initdb" "$pg_bin/pg_ctl" "$pg_bin/createdb" "$pg_bin/psql" \
  || fail 'The non-root test identity cannot read the checkout/dependencies or execute PostgreSQL. Fix access explicitly; no business directory permissions were changed.'
test "$cancel_status" = 0 || exit "$cancel_status"

for suite in applicant-forms audit-receipts chat-workspace procurement-rollback rd-documents; do
  test "$cancel_status" = 0 || exit "$cancel_status"
  runner="$api_root/scripts/test-$suite-postgres.mjs"
  log_file="$work_root/$suite.log"
  printf 'Running isolated PostgreSQL suite: %s\n' "$suite"
  # Launch setsid directly: a background shell function would leave a wait layer
  # in the terminal's process group, where a group SIGTERM could kill it early.
  "${test_command[@]}" "$node_bin" "$runner" > "$log_file" 2>&1 &
  runner_pid=$!
  # A trapped signal interrupts wait without stopping the isolated session. Keep
  # waiting so each existing runner can execute its own pg_ctl/finally cleanup.
  while true; do
    if wait "$runner_pid"; then runner_status=0; break; else runner_status=$?; fi
    test "$cancel_status" != 0 && test "$runner_status" != 127 && kill -0 "$runner_pid" 2>/dev/null || break
  done
  cat "$log_file"
  test "$cancel_status" = 0 || exit "$cancel_status"
  test "$runner_status" = 0 || fail "Suite failed: $suite"
  grep -Eq '^# pass [1-9][0-9]*$' "$log_file" && \
    grep -Eq '^# fail 0$' "$log_file" && grep -Eq '^# skipped 0$' "$log_file" && \
    ! grep -Eq '^# (fail|skipped) [1-9][0-9]*$' "$log_file" \
    || fail "Suite did not report passing tests with zero failures/skips: $suite"
done
test "$cancel_status" = 0 || exit "$cancel_status"
printf 'Isolated PostgreSQL gate passed: five suites, no skipped database checks.\n'
