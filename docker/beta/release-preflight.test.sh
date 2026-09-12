#!/bin/bash
# Regression test for the two gates in release-preflight.sh that stopped being able to use
# git, run with no Docker and no database:
#
#   docker/beta/release-preflight.test.sh
#
# Coolify deletes the checkout's .git before the preflight runs (cleanup_git() at
# ApplicationDeploymentJob.php:663, the preflight at 715), so the release sha now comes from
# SOURCE_COMMIT in /artifacts/build-time.env and the repository proof is the first migration
# file instead of the root commit. Both of those are string handling on untrusted input in
# the one script allowed to migrate the live beta database, which is exactly the kind of
# thing that should not be re-derived by reading it.
#
# Every case runs the SHIPPED script. The identity gates that follow need Docker, so a run
# that gets past the sha is expected to fail LATER, on the application identity -- reaching
# that point is the pass condition, and a run that stops earlier has regressed a gate.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
SCRIPT="$HERE/release-preflight.sh"
GOOD_SHA=fb0d776588d3bdf1552ca7dbf8d74c253388796a
ROOT_MIGRATION=api/db/migrations/20220521061146_init_schema.ts

pass=0
fail=0

# Run the preflight in a throwaway copy of the checkout: the real repository has a .git, and
# the whole point is the directory that does not.
run_preflight() {
  local sandbox env_file
  sandbox="$(mktemp -d)"
  env_file="$sandbox/build-time.env"
  mkdir -p "$sandbox/$(dirname "$ROOT_MIGRATION")"
  [ "${OMIT_ROOT_MIGRATION:-0}" = 1 ] || touch "$sandbox/$ROOT_MIGRATION"
  printf '%s' "${BUILD_TIME_ENV_BODY:-}" > "$env_file"
  cp "$SCRIPT" "$sandbox/release-preflight.sh"
  (
    cd "$sandbox" || exit 1
    CTR_BETA_BUILD_TIME_ENV="$env_file" \
    COMPOSE_PROJECT_NAME=ctr-preflight-test \
    CTR_BETA_APPLICATION_ID=999 \
    CTR_BETA_RESOURCE_NAME=ctr-preflight-test \
      bash ./release-preflight.sh 2>&1
  )
  rm -rf "$sandbox"
}

check() {
  local name="$1" expect="$2" out
  shift 2
  out="$(env "$@" bash -c 'run_preflight' 2>/dev/null)" || true
  if printf '%s' "$out" | grep -qF "$expect"; then
    echo "ok   -- $name"
    pass=$((pass + 1))
  else
    echo "FAIL -- $name"
    echo "        wanted to see: $expect"
    echo "        got: $(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
    fail=$((fail + 1))
  fi
}

export -f run_preflight
export SCRIPT ROOT_MIGRATION

# 1. No sha anywhere. This is the state the ctr-beta application is in until
#    include_source_commit_in_build is turned on, so the message has to say so.
check 'absent SOURCE_COMMIT fails closed' \
  "Turn on 'Include SOURCE_COMMIT in build'" \
  BUILD_TIME_ENV_BODY=''

# 2. Coolify writes the literal string HEAD before it has resolved the branch. Tagging an
#    image 'ctr-beta-tooling:HEAD' and calling it a release is the failure this rejects.
check 'unresolved HEAD is refused' \
  'is not a hex commit sha' \
  BUILD_TIME_ENV_BODY='SOURCE_COMMIT=HEAD'

check 'unknown is refused' \
  'is not a hex commit sha' \
  BUILD_TIME_ENV_BODY='SOURCE_COMMIT=unknown'

# 3. An abbreviated sha is hex and would pass a naive check, but it is not what was built.
check 'abbreviated sha is refused' \
  'is not a full 40-character commit sha' \
  BUILD_TIME_ENV_BODY='SOURCE_COMMIT=fb0d776'

# 4. A real sha is accepted, quotes and neighbouring keys and all, and the run continues to
#    the application identity gate -- which is the next thing that can stop it.
check 'valid sha is accepted and logged' \
  "release sha $GOOD_SHA" \
  BUILD_TIME_ENV_BODY="DB_USER=someone
SOURCE_COMMIT=\"$GOOD_SHA\"
NODE_ENV=production"

check 'valid sha reaches the application identity gate' \
  'ctr-preflight-test' \
  BUILD_TIME_ENV_BODY="SOURCE_COMMIT=$GOOD_SHA"

# 5. The environment overrides the file, so the script can be run by hand outside Coolify.
check 'SOURCE_COMMIT in the environment overrides the file' \
  "release sha $GOOD_SHA" \
  BUILD_TIME_ENV_BODY='SOURCE_COMMIT=HEAD' \
  SOURCE_COMMIT="$GOOD_SHA"

# 6. The repository proof. A checkout without CTR's first migration is not CTR, and must not
#    reach the database gates no matter how good its sha is.
check 'a checkout without the root migration is refused' \
  'is not a CTR repository' \
  BUILD_TIME_ENV_BODY="SOURCE_COMMIT=$GOOD_SHA" \
  OMIT_ROOT_MIGRATION=1

echo
echo "passed $pass, failed $fail"
[ "$fail" -eq 0 ]
