#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/tests/smoke/common.sh"

require_cmd curl
require_cmd node

info "running chat smoke against ${API_BASE}"
TOKEN="$(guest_token)"
OUT_FILE="${TEST_TMP_DIR}/chat-smoke.json"
SESSION_ID="chat_smoke_$(date +%s)"

STATUS_CODE="$(
  post_form_auth "${TOKEN}" "/api/chat/message" "${OUT_FILE}" \
    -F "content=请用一句话回复 chat smoke ok" \
    -F "sessionId=${SESSION_ID}"
)"

expect_http_ok "${STATUS_CODE}" "chat smoke"
expect_nonempty_json_field "${OUT_FILE}" "reply" "chat smoke"
expect_nonempty_json_field "${OUT_FILE}" "sessionId" "chat smoke"

pass "chat smoke"
