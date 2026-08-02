#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/tests/smoke/common.sh"

require_cmd curl
require_cmd node
require_cmd stat

info "running ambient-listening-audio smoke against ${API_BASE}"
TOKEN="$(guest_token)"

VOICE_AUDIO_FILE="${VOICE_SMOKE_AUDIO:-}"
if [[ -z "${VOICE_AUDIO_FILE}" ]]; then
  info "no VOICE_SMOKE_AUDIO provided, generating audio via /api/voice/tts"
  VOICE_AUDIO_FILE="${TEST_TMP_DIR}/ambient-voice-smoke.mp3"
  TTS_STATUS="$(
    post_json_auth \
      "${TOKEN}" \
      "/api/voice/tts" \
      '{"text":"hello william ambient listening smoke test","language":"en-US"}' \
      "${VOICE_AUDIO_FILE}"
  )"
  expect_http_ok "${TTS_STATUS}" "ambient listening tts"
fi

[[ -f "${VOICE_AUDIO_FILE}" ]] || fail "ambient listening audio not found: ${VOICE_AUDIO_FILE}"
[[ "$(stat -f %z "${VOICE_AUDIO_FILE}")" -gt 0 ]] || fail "ambient listening audio file is empty"

OUT_FILE="${TEST_TMP_DIR}/ambient-listening-audio-smoke.json"
STATUS_CODE="$(
  post_form_auth "${TOKEN}" "/api/voice/ambient-listening-audio" "${OUT_FILE}" \
    -F "audio=@${VOICE_AUDIO_FILE};type=audio/mpeg" \
    -F "sourcePage=chat" \
    -F "sourceSessionKey=ambient_smoke_case"
)"

expect_http_ok "${STATUS_CODE}" "ambient-listening-audio smoke"
expect_nonempty_json_field "${OUT_FILE}" "transcript" "ambient-listening-audio smoke"
expect_nonempty_json_field "${OUT_FILE}" "analysis.emotion" "ambient-listening-audio smoke"

pass "ambient-listening-audio smoke"
