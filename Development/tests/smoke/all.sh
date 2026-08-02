#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

"${ROOT_DIR}/tests/smoke/chat-smoke.sh"
"${ROOT_DIR}/tests/smoke/attachment-smoke.sh"
"${ROOT_DIR}/tests/smoke/call-turn-text-smoke.sh"
"${ROOT_DIR}/tests/smoke/voice-smoke.sh"
"${ROOT_DIR}/tests/smoke/voice-negative-smoke.sh"
"${ROOT_DIR}/tests/smoke/ambient-listening-audio-smoke.sh"
"${ROOT_DIR}/tests/smoke/schedule-candidate-smoke.sh"
"${ROOT_DIR}/tests/smoke/schedule-candidate-lifecycle-smoke.sh"
"${ROOT_DIR}/tests/smoke/today-smoke.sh"
"${ROOT_DIR}/tests/smoke/insights-smoke.sh"
"${ROOT_DIR}/tests/smoke/journey-smoke.sh"

if [[ "${RUN_URL_IMPORT_SMOKE:-0}" == "1" ]]; then
  "${ROOT_DIR}/tests/smoke/url-import-smoke.sh"
fi

printf '[PASS] all smoke tests\n'
