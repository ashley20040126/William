#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/tests/smoke/common.sh"

require_cmd curl
require_cmd node

info "running call-turn-text smoke against ${API_BASE}"
TOKEN="$(guest_token)"
OUT_FILE="${TEST_TMP_DIR}/call-turn-text-smoke.json"
TRANSCRIPT="测试一下语音通话文本入口"
SESSION_ID="call_turn_text_smoke_$(date +%s)"
REQUEST_BODY="$(printf '{"transcript":"%s","sessionId":"%s"}' "${TRANSCRIPT}" "${SESSION_ID}")"

STATUS_CODE="$(post_json_auth "${TOKEN}" "/api/voice/call-turn-text" "${REQUEST_BODY}" "${OUT_FILE}")"

expect_http_ok "${STATUS_CODE}" "call-turn-text smoke"
expect_json_field_equals "${OUT_FILE}" "transcript" "${TRANSCRIPT}" "call-turn-text smoke"
expect_nonempty_json_field "${OUT_FILE}" "reply" "call-turn-text smoke"
expect_nonempty_json_field "${OUT_FILE}" "sessionId" "call-turn-text smoke"

pass "call-turn-text smoke"
