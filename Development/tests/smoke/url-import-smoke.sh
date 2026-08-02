#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/tests/smoke/common.sh"

require_cmd curl
require_cmd node

URL_IMPORT_TARGET="${URL_IMPORT_TARGET:-https://example.com}"

info "running url-import smoke against ${API_BASE}"
TOKEN="$(guest_token)"
OUT_FILE="${TEST_TMP_DIR}/url-import-smoke.json"
SESSION_ID="url_import_smoke_$(date +%s)"

STATUS_CODE="$(
  post_form_auth "${TOKEN}" "/api/chat/message" "${OUT_FILE}" \
    -F "aiChatUrl=${URL_IMPORT_TARGET}" \
    -F "sessionId=${SESSION_ID}"
)"

expect_http_ok "${STATUS_CODE}" "url-import smoke"
expect_nonempty_json_array "${OUT_FILE}" "userMessage.attachments" "url-import smoke"
expect_nonempty_json_field "${OUT_FILE}" "userMessage.attachments.0.summary" "url-import smoke"
expect_nonempty_json_field "${OUT_FILE}" "reply" "url-import smoke"

pass "url-import smoke"
