#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/tests/smoke/common.sh"

require_cmd curl
require_cmd node

info "running journey smoke against ${API_BASE}"
TOKEN="$(guest_token)"

ENROLL_OUT="${TEST_TMP_DIR}/journey-enrollments-smoke.json"
PATHS_OUT="${TEST_TMP_DIR}/journey-paths-smoke.json"
PRACTICES_OUT="${TEST_TMP_DIR}/journey-practices-smoke.json"

STATUS_CODE="$(get_auth "${TOKEN}" "/api/journey" "${ENROLL_OUT}")"
expect_http_ok "${STATUS_CODE}" "journey enrollments smoke"
expect_json_root_array "${ENROLL_OUT}" "journey enrollments smoke"

STATUS_CODE="$(get_auth "${TOKEN}" "/api/journey/paths" "${PATHS_OUT}")"
expect_http_ok "${STATUS_CODE}" "journey paths smoke"
expect_json_root_array "${PATHS_OUT}" "journey paths smoke"

STATUS_CODE="$(get_auth "${TOKEN}" "/api/journey/practices" "${PRACTICES_OUT}")"
expect_http_ok "${STATUS_CODE}" "journey practices smoke"
expect_json_root_object "${PRACTICES_OUT}" "journey practices smoke"

pass "journey smoke"
