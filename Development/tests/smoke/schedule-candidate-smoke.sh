#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/tests/smoke/common.sh"

require_cmd curl
require_cmd node

info "running schedule-candidate smoke against ${API_BASE}"
TOKEN="$(guest_token)"
OUT_FILE="${TEST_TMP_DIR}/schedule-candidate-smoke.json"
SESSION_ID="schedule_candidate_smoke_$(date +%s)"

STATUS_CODE="$(
  post_form_auth "${TOKEN}" "/api/chat/message" "${OUT_FILE}" \
    -F "content=今天下午3-5要去体育馆打球" \
    -F "sessionId=${SESSION_ID}"
)"

expect_http_ok "${STATUS_CODE}" "schedule-candidate smoke"
expect_nonempty_json_array "${OUT_FILE}" "userMessage.scheduleCandidates" "schedule-candidate smoke"
expect_nonempty_json_field "${OUT_FILE}" "userMessage.scheduleCandidates.0.title" "schedule-candidate smoke"

pass "schedule-candidate smoke"
