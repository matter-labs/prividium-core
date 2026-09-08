#!/usr/bin/env bash
set -Eeuo pipefail
IFS=$'\n\t'

# Runtime dependencies only: dev tooling is not redistributed under the repo licence.
# Run from the repository root after `pnpm install`.

readonly ALLOWED_LICENCES='[
  "MIT", "MIT OR Apache-2.0", "0BSD", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Apache-2.0", "MPL-2.0",
  "CC0-1.0", "CC-BY-3.0", "CC-BY-4.0", "Python-2.0", "Artistic-2.0", "Zlib", "Unlicense", "UNLICENSED",
  "BlueOak-1.0.0"
]'

main() {
  local disallowed
  disallowed=$(pnpm licenses list --prod --json \
    | jq -r --argjson allowed "${ALLOWED_LICENCES}" \
      'to_entries[]
       | select(.key as $l | $allowed | index($l) | not)
       | "\(.key): \([.value[].name] | join(", "))"')

  if [[ -n "${disallowed}" ]]; then
    echo "::error::Runtime dependencies with a licence outside the allowlist:" >&2
    echo "${disallowed}" >&2
    exit 1
  fi
  echo "All runtime dependency licences are on the allowlist."
}

main "$@"
