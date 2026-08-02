#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/tests/smoke/common.sh"

require_cmd curl
require_cmd node
require_cmd stat

info "running voice smoke against ${API_BASE}"
TOKEN="$(guest_token)"

VOICE_AUDIO_FILE="${VOICE_SMOKE_AUDIO:-}"
if [[ -z "${VOICE_AUDIO_FILE}" ]]; then
  info "no VOICE_SMOKE_AUDIO provided, generating audio via /api/voice/tts"
  VOICE_AUDIO_FILE="${TEST_TMP_DIR}/voice-smoke.mp3"
  TTS_STATUS="$(
    post_json_auth \
      "${TOKEN}" \
      "/api/voice/tts" \
      '{"text":"hello william this is a voice smoke test","language":"en-US"}' \
      "${VOICE_AUDIO_FILE}"
  )"
  expect_http_ok "${TTS_STATUS}" "voice smoke tts"
fi

[[ -f "${VOICE_AUDIO_FILE}" ]] || fail "voice smoke audio not found: ${VOICE_AUDIO_FILE}"
[[ "$(stat -f %z "${VOICE_AUDIO_FILE}")" -gt 0 ]] || fail "voice smoke audio file is empty"

TRANSCRIBE_OUT="${TEST_TMP_DIR}/voice-transcribe-smoke.json"
TRANSCRIBE_STATUS="$(
  post_form_auth "${TOKEN}" "/api/voice/transcribe" "${TRANSCRIBE_OUT}" \
    -F "audio=@${VOICE_AUDIO_FILE};type=audio/mpeg"
)"
expect_http_ok "${TRANSCRIBE_STATUS}" "voice transcribe smoke"
expect_nonempty_json_field "${TRANSCRIBE_OUT}" "text" "voice transcribe smoke"

PREVIEW_OUT="${TEST_TMP_DIR}/voice-preview-smoke.json"
PREVIEW_STATUS="$(
  post_form_auth "${TOKEN}" "/api/voice/transcribe-chunk" "${PREVIEW_OUT}" \
    -F "audio=@${VOICE_AUDIO_FILE};type=audio/mpeg"
)"
expect_http_ok "${PREVIEW_STATUS}" "voice preview smoke"
expect_nonempty_json_field "${PREVIEW_OUT}" "text" "voice preview smoke"

pass "voice smoke"
