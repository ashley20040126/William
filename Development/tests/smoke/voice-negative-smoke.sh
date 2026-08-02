#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "${ROOT_DIR}/tests/smoke/common.sh"

require_cmd curl
require_cmd node
require_cmd dd

info "running voice negative smoke against ${API_BASE}"
TOKEN="$(guest_token)"

NO_FILE_OUT="${TEST_TMP_DIR}/voice-negative-no-file.json"
NO_FILE_STATUS="$(
  curl --noproxy '*' -sS -o "${NO_FILE_OUT}" -w '%{http_code}' \
    -X POST "${API_BASE}/api/voice/transcribe" \
    -H "Authorization: Bearer ${TOKEN}"
)"
expect_http_status "${NO_FILE_STATUS}" "400" "voice negative missing audio"
expect_json_field_equals "${NO_FILE_OUT}" "error" "Audio file required" "voice negative missing audio"

NON_AUDIO_FILE="${TEST_TMP_DIR}/voice-negative-not-audio.txt"
node -e "require('fs').writeFileSync(process.argv[1], 'not audio')" "${NON_AUDIO_FILE}"
NON_AUDIO_OUT="${TEST_TMP_DIR}/voice-negative-non-audio.json"
NON_AUDIO_STATUS="$(
  post_form_auth "${TOKEN}" "/api/voice/transcribe" "${NON_AUDIO_OUT}" \
    -F "audio=@${NON_AUDIO_FILE};type=text/plain"
)"
expect_http_status "${NON_AUDIO_STATUS}" "400" "voice negative non-audio"
expect_json_field_equals "${NON_AUDIO_OUT}" "error" "Only audio uploads are supported." "voice negative non-audio"

TOO_LARGE_FILE="${TEST_TMP_DIR}/voice-negative-too-large.mp3"
dd if=/dev/zero of="${TOO_LARGE_FILE}" bs=1048576 count=16 >/dev/null 2>&1
TOO_LARGE_OUT="${TEST_TMP_DIR}/voice-negative-too-large.json"
TOO_LARGE_STATUS="$(
  post_form_auth "${TOKEN}" "/api/voice/transcribe" "${TOO_LARGE_OUT}" \
    -F "audio=@${TOO_LARGE_FILE};type=audio/mpeg"
)"
expect_http_status "${TOO_LARGE_STATUS}" "413" "voice negative too large"
expect_json_field_contains "${TOO_LARGE_OUT}" "error" "under 15MB" "voice negative too large"

SILENT_AUDIO_FILE="${TEST_TMP_DIR}/voice-negative-silence.wav"
node - "${SILENT_AUDIO_FILE}" <<'NODE'
const fs = require('fs');
const outputPath = process.argv[2];
const sampleRate = 16000;
const channels = 1;
const bitsPerSample = 16;
const seconds = 2;
const totalSamples = sampleRate * seconds;
const blockAlign = channels * bitsPerSample / 8;
const byteRate = sampleRate * blockAlign;
const dataSize = totalSamples * blockAlign;
const buffer = Buffer.alloc(44 + dataSize);
buffer.write('RIFF', 0);
buffer.writeUInt32LE(36 + dataSize, 4);
buffer.write('WAVE', 8);
buffer.write('fmt ', 12);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(channels, 22);
buffer.writeUInt32LE(sampleRate, 24);
buffer.writeUInt32LE(byteRate, 28);
buffer.writeUInt16LE(blockAlign, 32);
buffer.writeUInt16LE(bitsPerSample, 34);
buffer.write('data', 36);
buffer.writeUInt32LE(dataSize, 40);
fs.writeFileSync(outputPath, buffer);
NODE
SILENT_OUT="${TEST_TMP_DIR}/voice-negative-silence.json"
SILENT_STATUS="$(
  post_form_auth "${TOKEN}" "/api/voice/ambient-listening-audio" "${SILENT_OUT}" \
    -F "audio=@${SILENT_AUDIO_FILE};type=audio/wav" \
    -F "sourcePage=chat" \
    -F "sourceSessionKey=ambient_negative_smoke"
)"
expect_http_status "${SILENT_STATUS}" "422" "voice negative no speech"
expect_json_field_equals "${SILENT_OUT}" "error" "No speech detected" "voice negative no speech"

INVALID_CHUNK_FILE="${TEST_TMP_DIR}/voice-negative-invalid-chunk.bin"
node -e "require('fs').writeFileSync(process.argv[1], Buffer.from('not-a-valid-audio-stream'))" "${INVALID_CHUNK_FILE}"
INVALID_CHUNK_OUT="${TEST_TMP_DIR}/voice-negative-invalid-chunk.json"
INVALID_CHUNK_STATUS="$(
  post_form_auth "${TOKEN}" "/api/voice/transcribe-chunk" "${INVALID_CHUNK_OUT}" \
    -F "audio=@${INVALID_CHUNK_FILE};type=audio/mpeg"
)"
expect_http_ok "${INVALID_CHUNK_STATUS}" "voice negative invalid chunk"
expect_json_field_equals "${INVALID_CHUNK_OUT}" "ignored" "true" "voice negative invalid chunk"
expect_json_field_equals "${INVALID_CHUNK_OUT}" "text" "" "voice negative invalid chunk"

pass "voice negative smoke"
