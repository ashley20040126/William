#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/tests/smoke/common.sh"

require_cmd curl
require_cmd node

info "running attachment smoke against ${API_BASE}"
TOKEN="$(guest_token)"
OUT_FILE="${TEST_TMP_DIR}/attachment-smoke.json"
FIXTURE_FILE="${TEST_TMP_DIR}/attachment-smoke.txt"
SESSION_ID="attachment_smoke_$(date +%s)"

cat > "${FIXTURE_FILE}" <<'EOF'
我最近在准备和老板谈离职，但还没想好怎么开口。
EOF

STATUS_CODE="$(
  post_form_auth "${TOKEN}" "/api/chat/message" "${OUT_FILE}" \
    -F "content=你先看这个文件。" \
    -F "sessionId=${SESSION_ID}" \
    -F "files=@${FIXTURE_FILE};type=text/plain"
)"

expect_http_ok "${STATUS_CODE}" "attachment smoke"
expect_nonempty_json_array "${OUT_FILE}" "userMessage.attachments" "attachment smoke"
expect_nonempty_json_field "${OUT_FILE}" "userMessage.attachments.0.name" "attachment smoke"
expect_nonempty_json_field "${OUT_FILE}" "reply" "attachment smoke"

pass "attachment smoke"
