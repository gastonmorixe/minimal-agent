#!/usr/bin/env bash
# Live e2e runner for the opencode-go provider.
#
# These tests hit the REAL gateway with the operator's REAL credential. They are
# excluded from the default `bun test` gate (Bun only auto-discovers
# `*.test.*` / `*.spec.*`, and these files are `*.e2e.ts`), so nothing runs
# unless you invoke this script.
#
# Usage:
#   ./scripts/test-e2e-opencode-go.sh                 # all suites
#   ./scripts/test-e2e-opencode-go.sh plugin          # plugin adapter only
#   ./scripts/test-e2e-opencode-go.sh cli             # CLI end-to-end only
#   ./scripts/test-e2e-opencode-go.sh -t "gzip"       # extra args -> bun test
#
# Env:
#   MA_E2E_CREDENTIAL_NAME  credential to use (default opencode-console-oauth-2)
#   MA_E2E_MODEL            model to exercise (default deepseek-v4.1-flash)
#   MA_E2E_TIMEOUT          per-test timeout ms (default 180000)
#
# Exit code is non-zero if any suite fails.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CREDENTIAL_NAME="${MA_E2E_CREDENTIAL_NAME:-opencode-console-oauth-2}"
MODEL="${MA_E2E_MODEL:-deepseek-v4.1-flash}"
TIMEOUT="${MA_E2E_TIMEOUT:-180000}"
WHICH="${1:-all}"
shift 2>/dev/null || true

# Anything left in "$@" is forwarded to bun test (e.g. -t "gzip request body").
EXTRA_ARGS=("$@")

export MA_E2E_LIVE=1
export MA_E2E_CREDENTIAL_NAME="$CREDENTIAL_NAME"
export MA_E2E_MODEL="$MODEL"
# A live suite must never be silently satisfied by the scripted transport.
unset MINIMAL_AGENT_TRANSPORT
unset MINIMAL_AGENT_TEST_AUTH
unset MINIMAL_AGENT_TEST_RESPONSE

hr() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

echo "opencode-go live e2e"
echo "  credential : $CREDENTIAL_NAME"
echo "  model      : $MODEL"
echo "  timeout    : ${TIMEOUT}ms per test"
echo "  suites     : $WHICH"

FAILED=0

run_suite() { # $1=label  $2=cwd  $3=glob
  local label="$1" cwd="$2" glob="$3"
  hr "$label"
  if [ ! -d "$cwd" ]; then
    echo "  SKIP: $cwd not present"
    return 0
  fi
  # Shell-expand the glob so Bun receives explicit file paths: a directory
  # filter would NOT match `*.e2e.ts` (Bun's discovery only knows
  # .test/_test/.spec/_spec).
  local files
  # shellcheck disable=SC2086
  files=$(cd "$cwd" && ls $glob 2>/dev/null)
  if [ -z "$files" ]; then
    echo "  SKIP: no files matching $glob"
    return 0
  fi
  local rc=0
  ( cd "$cwd" && bun test $glob "${EXTRA_ARGS[@]}" --timeout "$TIMEOUT" ) || rc=$?
  if [ "$rc" -ne 0 ]; then
    FAILED=1
    echo "  FAILED ($label) rc=$rc"
  fi
  return 0
}

case "$WHICH" in
  plugin)
    run_suite "plugin adapter (live)" \
      "$REPO_ROOT/minimal-agent-plugins/ma-llm-opencode-go-plugin" "./e2e/*.e2e.ts"
    ;;
  cli)
    run_suite "CLI end-to-end (live)" \
      "$REPO_ROOT/minimal-agent-cli" "./src/e2e/opencode-go-live.e2e.ts"
    ;;
  all)
    run_suite "plugin adapter (live)" \
      "$REPO_ROOT/minimal-agent-plugins/ma-llm-opencode-go-plugin" "./e2e/*.e2e.ts"
    run_suite "CLI end-to-end (live)" \
      "$REPO_ROOT/minimal-agent-cli" "./src/e2e/opencode-go-live.e2e.ts"
    ;;
  *)
    echo "unknown suite '$WHICH' (expected: all | plugin | cli)" >&2
    exit 2
    ;;
esac

hr "result"
if [ "$FAILED" -ne 0 ]; then
  echo "FAILED"
  exit 1
fi
echo "OK"
