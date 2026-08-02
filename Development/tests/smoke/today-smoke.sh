#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/tests/smoke/common.sh"

require_cmd curl
require_cmd node

info "running today smoke against ${API_BASE}"
TOKEN="$(guest_token)"
OUT_FILE="${TEST_TMP_DIR}/today-smoke.json"

STATUS_CODE="$(get_auth "${TOKEN}" "/api/user/today" "${OUT_FILE}")"

expect_http_ok "${STATUS_CODE}" "today smoke"
expect_nonempty_json_array "${OUT_FILE}" "monthlyPaths" "today smoke"
expect_nonempty_json_array "${OUT_FILE}" "practiceTodos" "today smoke"

pass "today smoke"
