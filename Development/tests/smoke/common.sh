#!/usr/bin/env bash

set -euo pipefail

API_BASE="${API_BASE:-http://127.0.0.1:3103}"
TEST_TMP_DIR="${TEST_TMP_DIR:-/tmp/william-smoke}"

mkdir -p "${TEST_TMP_DIR}"

info() {
  printf '[INFO] %s\n' "$*"
}

pass() {
  printf '[PASS] %s\n' "$*"
}

fail() {
  printf '[FAIL] %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "missing required command: $1"
}

json_get_file() {
  local file_path="$1"
  local field_path="$2"
  node - "$file_path" "$field_path" <<'NODE'
const fs = require('fs');
const [filePath, fieldPath] = process.argv.slice(2);
const raw = fs.readFileSync(filePath, 'utf8');
const data = raw ? JSON.parse(raw) : null;
const keys = fieldPath.split('.');
let value = data;
for (const key of keys) {
  if (value == null) break;
  value = value[key];
}
if (value == null) {
  process.stdout.write('');
} else if (typeof value === 'object') {
  process.stdout.write(JSON.stringify(value));
} else {
  process.stdout.write(String(value));
}
NODE
}

expect_http_ok() {
  local status_code="$1"
  local label="$2"
  if [[ "${status_code}" != "200" ]]; then
    fail "${label} failed with HTTP ${status_code}"
  fi
}

expect_http_status() {
  local status_code="$1"
  local expected="$2"
  local label="$3"
  if [[ "${status_code}" != "${expected}" ]]; then
    fail "${label} expected HTTP ${expected}, got ${status_code}"
  fi
}

expect_nonempty_json_field() {
  local file_path="$1"
  local field_path="$2"
  local label="$3"
  local value
  value="$(json_get_file "${file_path}" "${field_path}")"
  if [[ -z "${value}" ]]; then
    fail "${label} missing JSON field: ${field_path}"
  fi
}

expect_nonempty_json_array() {
  local file_path="$1"
  local field_path="$2"
  local label="$3"
  node - "$file_path" "$field_path" "$label" <<'NODE'
const fs = require('fs');
const [filePath, fieldPath, label] = process.argv.slice(2);
const raw = fs.readFileSync(filePath, 'utf8');
const data = raw ? JSON.parse(raw) : null;
const keys = fieldPath.split('.');
let value = data;
for (const key of keys) {
  if (value == null) break;
  value = value[key];
}
if (!Array.isArray(value) || value.length === 0) {
  console.error(`[FAIL] ${label} expected non-empty array at ${fieldPath}`);
  process.exit(1);
}
NODE
}

expect_json_root_array() {
  local file_path="$1"
  local label="$2"
  node - "$file_path" "$label" <<'NODE'
const fs = require('fs');
const [filePath, label] = process.argv.slice(2);
const raw = fs.readFileSync(filePath, 'utf8');
const data = raw ? JSON.parse(raw) : null;
if (!Array.isArray(data)) {
  console.error(`[FAIL] ${label} expected root JSON array`);
  process.exit(1);
}
NODE
}

expect_json_root_object() {
  local file_path="$1"
  local label="$2"
  node - "$file_path" "$label" <<'NODE'
const fs = require('fs');
const [filePath, label] = process.argv.slice(2);
const raw = fs.readFileSync(filePath, 'utf8');
const data = raw ? JSON.parse(raw) : null;
if (!data || typeof data !== 'object' || Array.isArray(data)) {
  console.error(`[FAIL] ${label} expected root JSON object`);
  process.exit(1);
}
NODE
}

expect_json_field_equals() {
  local file_path="$1"
  local field_path="$2"
  local expected="$3"
  local label="$4"
  local value
  value="$(json_get_file "${file_path}" "${field_path}")"
  if [[ "${value}" != "${expected}" ]]; then
    fail "${label} expected ${field_path}=${expected}, got ${value:-<empty>}"
  fi
}

expect_json_field_contains() {
  local file_path="$1"
  local field_path="$2"
  local expected_fragment="$3"
  local label="$4"
  local value
  value="$(json_get_file "${file_path}" "${field_path}")"
  if [[ "${value}" != *"${expected_fragment}"* ]]; then
    fail "${label} expected ${field_path} to contain ${expected_fragment}, got ${value:-<empty>}"
  fi
}

guest_token() {
  local token_file="${TEST_TMP_DIR}/guest-token.json"
  local status_code
  status_code="$(
    curl --noproxy '*' -sS -o "${token_file}" -w '%{http_code}' \
      -X POST "${API_BASE}/api/auth/guest" \
      -H 'Content-Type: application/json' \
      -d '{}'
  )"
  expect_http_ok "${status_code}" "guest auth"
  local token
  token="$(json_get_file "${token_file}" "token")"
  [[ -n "${token}" ]] || fail 'guest auth returned empty token'
  printf '%s' "${token}"
}

post_json_auth() {
  local token="$1"
  local path="$2"
  local body="$3"
  local out_file="$4"
  curl --noproxy '*' -sS -o "${out_file}" -w '%{http_code}' \
    -X POST "${API_BASE}${path}" \
    -H "Authorization: Bearer ${token}" \
    -H 'Content-Type: application/json' \
    -d "${body}"
}

get_auth() {
  local token="$1"
  local path="$2"
  local out_file="$3"
  curl --noproxy '*' -sS -o "${out_file}" -w '%{http_code}' \
    -X GET "${API_BASE}${path}" \
    -H "Authorization: Bearer ${token}"
}

post_form_auth() {
  local token="$1"
  local path="$2"
  local out_file="$3"
  shift 3
  curl --noproxy '*' -sS -o "${out_file}" -w '%{http_code}' \
    -X POST "${API_BASE}${path}" \
    -H "Authorization: Bearer ${token}" \
    "$@"
}
