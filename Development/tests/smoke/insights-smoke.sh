#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/tests/smoke/common.sh"

require_cmd curl
require_cmd node

info "running insights smoke against ${API_BASE}"
TOKEN="$(guest_token)"
OUT_FILE="${TEST_TMP_DIR}/insights-smoke.json"

STATUS_CODE="$(get_auth "${TOKEN}" "/api/user/insights?days=14" "${OUT_FILE}")"

expect_http_ok "${STATUS_CODE}" "insights smoke"
expect_json_root_object "${OUT_FILE}" "insights smoke"
expect_nonempty_json_field "${OUT_FILE}" "insights" "insights smoke"
expect_nonempty_json_field "${OUT_FILE}" "patterns" "insights smoke"
expect_nonempty_json_field "${OUT_FILE}" "triggers" "insights smoke"

pass "insights smoke"
