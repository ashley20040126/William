#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/tests/smoke/common.sh"

require_cmd curl
require_cmd node

info "running schedule-candidate lifecycle smoke against ${API_BASE}"
TOKEN="$(guest_token)"
CREATE_OUT="${TEST_TMP_DIR}/schedule-candidate-lifecycle-create.json"
CONFIRM_OUT="${TEST_TMP_DIR}/schedule-candidate-lifecycle-confirm.json"
DISMISS_OUT="${TEST_TMP_DIR}/schedule-candidate-lifecycle-dismiss.json"
SESSION_ID="schedule_lifecycle_smoke_$(date +%s)"

CREATE_STATUS="$(
  post_form_auth "${TOKEN}" "/api/chat/message" "${CREATE_OUT}" \
    -F "content=明天下午三点和老板聊离职" \
    -F "sessionId=${SESSION_ID}"
)"

expect_http_ok "${CREATE_STATUS}" "schedule-candidate lifecycle create"
expect_nonempty_json_array "${CREATE_OUT}" "userMessage.scheduleCandidates" "schedule-candidate lifecycle create"

CANDIDATE_ID="$(json_get_file "${CREATE_OUT}" "userMessage.scheduleCandidates.0.id")"
[[ -n "${CANDIDATE_ID}" ]] || fail "schedule-candidate lifecycle missing candidate id"

CONFIRM_STATUS="$(
  post_json_auth "${TOKEN}" "/api/journey/schedule-candidates/${CANDIDATE_ID}/confirm" '{}' "${CONFIRM_OUT}"
)"
expect_http_ok "${CONFIRM_STATUS}" "schedule-candidate lifecycle confirm"
expect_json_field_equals "${CONFIRM_OUT}" "status" "confirmed" "schedule-candidate lifecycle confirm"

DISMISS_STATUS="$(
  post_json_auth "${TOKEN}" "/api/journey/schedule-candidates/${CANDIDATE_ID}/dismiss" '{}' "${DISMISS_OUT}"
)"
expect_http_ok "${DISMISS_STATUS}" "schedule-candidate lifecycle dismiss"
expect_json_field_equals "${DISMISS_OUT}" "status" "dismissed" "schedule-candidate lifecycle dismiss"

pass "schedule-candidate lifecycle smoke"
