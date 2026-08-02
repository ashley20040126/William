#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEVELOPMENT_DIR="$(cd "${TESTS_DIR}/.." && pwd)"
BACKEND_DIR="${DEVELOPMENT_DIR}/backend"

API_BASE="${API_BASE:-http://127.0.0.1:3103}"
CASES_FILE="${CASES_FILE:-${TESTS_DIR}/fixtures/real-conversation-review.sample.json}"
OUT_DIR="${OUT_DIR:-/tmp/william-real-review-live}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      shift
      cd "${BACKEND_DIR}"
      npm run review:real:render -- --dry-run --cases "${CASES_FILE}" --out "${OUT_DIR}" "$@"
      exit 0
      ;;
    --cases)
      CASES_FILE="$2"
      shift 2
      ;;
    --out)
      OUT_DIR="$2"
      shift 2
      ;;
    --api-base)
      API_BASE="$2"
      shift 2
      ;;
    *)
      echo "[FAIL] unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

mkdir -p "${OUT_DIR}"

TMP_DIR="$(mktemp -d /tmp/william-real-review-run.XXXXXX)"
trap 'rm -rf "${TMP_DIR}"' EXIT

CASES_NDJSON="${TMP_DIR}/cases.ndjson"
>"${CASES_NDJSON}"

node - "${CASES_FILE}" <<'NODE' > "${TMP_DIR}/cases.b64"
const fs = require('fs');
const filePath = process.argv[2];
const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
for (const reviewCase of payload.cases || []) {
  process.stdout.write(Buffer.from(JSON.stringify(reviewCase)).toString('base64') + '\n');
}
NODE

while IFS= read -r case_b64 || [[ -n "${case_b64}" ]]; do
  [[ -n "${case_b64}" ]] || continue

  CASE_ID="$(node -e "const c=JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8')); process.stdout.write(c.id);" "${case_b64}")"
  CASE_TURNS_NDJSON="${TMP_DIR}/${CASE_ID}.turns.ndjson"
  >"${CASE_TURNS_NDJSON}"

  GUEST_STATUS="$(
    curl --noproxy '*' -sS -o "${TMP_DIR}/guest.json" -w '%{http_code}' \
      -X POST "${API_BASE}/api/auth/guest" \
      -H 'Content-Type: application/json' \
      -d '{}'
  )"
  if [[ "${GUEST_STATUS}" != "200" ]]; then
    echo "[FAIL] guest auth failed for ${CASE_ID} with HTTP ${GUEST_STATUS}" >&2
    exit 1
  fi

  TOKEN="$(node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(d.token || '');" "${TMP_DIR}/guest.json")"
  if [[ -z "${TOKEN}" ]]; then
    echo "[FAIL] empty guest token for ${CASE_ID}" >&2
    exit 1
  fi

  PROFILE_JSON="$(
    node -e "const c=JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8')); const body={...(c.profile||{}), voice_mode:c.voiceMode||'classic', language:c.language||'zh-CN', memory_enabled:c.memoryEnabled===false?0:1}; process.stdout.write(JSON.stringify(body));" \
      "${case_b64}"
  )"
  PROFILE_STATUS="$(
    curl --noproxy '*' -sS -o "${TMP_DIR}/profile.json" -w '%{http_code}' \
      -X POST "${API_BASE}/api/user/profile" \
      -H "Authorization: Bearer ${TOKEN}" \
      -H 'Content-Type: application/json' \
      -d "${PROFILE_JSON}"
  )"
  if [[ "${PROFILE_STATUS}" != "200" ]]; then
    echo "[FAIL] profile update failed for ${CASE_ID} with HTTP ${PROFILE_STATUS}" >&2
    exit 1
  fi

  SESSION_ID="${CASE_ID}_$(date +%s)_$RANDOM"
  TEMPORARY_CHAT="$(
    node -e "const c=JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8')); process.stdout.write(c.temporaryChat ? 'true' : 'false');" \
      "${case_b64}"
  )"

  node - "${case_b64}" <<'NODE' > "${TMP_DIR}/${CASE_ID}.turns.b64"
const reviewCase = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
for (const turn of reviewCase.turns || []) {
  process.stdout.write(Buffer.from(JSON.stringify(turn)).toString('base64') + '\n');
}
NODE

  TURN_INDEX=0
  while IFS= read -r turn_b64 || [[ -n "${turn_b64}" ]]; do
    [[ -n "${turn_b64}" ]] || continue
    TURN_INDEX=$((TURN_INDEX + 1))
    TURN_CONTENT="$(
      node -e "const t=JSON.parse(Buffer.from(process.argv[1],'base64').toString('utf8')); process.stdout.write(t.content);" \
        "${turn_b64}"
    )"

    CHAT_STATUS="$(
      curl --noproxy '*' -sS -o "${TMP_DIR}/chat.json" -w '%{http_code}' \
        -X POST "${API_BASE}/api/chat/message" \
        -H "Authorization: Bearer ${TOKEN}" \
        -F "content=${TURN_CONTENT}" \
        -F "sessionId=${SESSION_ID}" \
        $( [[ "${TEMPORARY_CHAT}" == "true" ]] && printf '%s' '-F temporaryChat=true' )
    )"
    if [[ "${CHAT_STATUS}" != "200" ]]; then
      echo "[FAIL] chat turn ${TURN_INDEX} failed for ${CASE_ID} with HTTP ${CHAT_STATUS}" >&2
      exit 1
    fi

    node - "${turn_b64}" "${TMP_DIR}/chat.json" "${TURN_INDEX}" <<'NODE' >> "${CASE_TURNS_NDJSON}"
const fs = require('fs');
const turn = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
const response = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const index = Number(process.argv[4]);
process.stdout.write(`${JSON.stringify({
  index,
  userInput: turn.content,
  assistantReply: response.reply || '',
  analysis: response.analysis || null,
  scheduleCandidates: response.userMessage?.scheduleCandidates || [],
  reviewerNotes: turn.reviewerNotes || '',
  expectedQualities: turn.expectedQualities || [],
})}\n`);
NODE
  done < "${TMP_DIR}/${CASE_ID}.turns.b64"

  node - "${case_b64}" "${CASE_TURNS_NDJSON}" <<'NODE' >> "${CASES_NDJSON}"
const fs = require('fs');
const reviewCase = JSON.parse(Buffer.from(process.argv[2], 'base64').toString('utf8'));
const turns = fs.readFileSync(process.argv[3], 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
process.stdout.write(`${JSON.stringify({
  id: reviewCase.id,
  title: reviewCase.title,
  tags: reviewCase.tags || [],
  focus: reviewCase.reviewFocus || [],
  mode: reviewCase.voiceMode || 'classic',
  temporaryChat: Boolean(reviewCase.temporaryChat),
  error: null,
  turns,
})}\n`);
NODE
done < "${TMP_DIR}/cases.b64"

node - "${CASES_FILE}" "${CASES_NDJSON}" "${OUT_DIR}/review-results.json" "${API_BASE}" <<'NODE'
const fs = require('fs');
const casesFile = process.argv[2];
const casesNdjson = process.argv[3];
const outFile = process.argv[4];
const apiBase = process.argv[5];
const payload = JSON.parse(fs.readFileSync(casesFile, 'utf8'));
const cases = fs.readFileSync(casesNdjson, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const result = {
  generatedAt: new Date().toISOString(),
  apiBase,
  casesPath: casesFile,
  outputDir: require('path').dirname(outFile),
  dryRun: false,
  title: payload.meta?.title || 'William Real Conversation Review',
  cases,
};
fs.writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);
NODE

cd "${BACKEND_DIR}"
npm run review:real:render -- --results "${OUT_DIR}/review-results.json" --out "${OUT_DIR}" >/tmp/william-real-review-render.log
cat /tmp/william-real-review-render.log
