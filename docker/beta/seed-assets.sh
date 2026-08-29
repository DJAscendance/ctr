#!/bin/sh
# Seeds the tracked default assets into a runtime asset volume, and proves it worked.
#
# A named volume mounted over a populated directory starts EMPTY: Docker seeds it from
# the image at that path, so any tracked file the image supplies underneath the mount is
# hidden rather than copied. `assets/object` and `assets/avatars` hold both runtime
# uploads and tracked defaults -- including `avatars/1/default.*`, the avatar every
# member starts with -- so the defaults have to be put back after the volume is mounted.
#
# Two properties matter and both are enforced here:
#
#   * a file a citizen uploaded at runtime is NEVER overwritten by a redeploy (`cp -n`);
#   * a seed that did not land is FATAL, not a log line. The previous version sent cp's
#     output and status to /dev/null, so a missing seed source or an unwritable volume
#     produced a running service quietly missing its default assets.
#
# cp's own exit status is deliberately not trusted -- some implementations report failure
# when -n skipped every file, which is the normal case on the second start. The copy is
# verified by comparing the trees instead.
#
# Usage: seed-assets.sh <subdirectory>...
#   SEED_ROOT    read-only copy of the tracked assets baked into the image
#   TARGET_ROOT  the assets directory the runtime volumes are mounted inside
set -eu

SEED_ROOT=${SEED_ROOT:-/opt/seed-assets}
TARGET_ROOT=${TARGET_ROOT:-/usr/src/app/assets}

if [ "$#" -eq 0 ]; then
  echo "seed-assets: FATAL no asset trees named" >&2
  exit 1
fi

if [ ! -d "$SEED_ROOT" ]; then
  echo "seed-assets: FATAL seed root $SEED_ROOT does not exist" >&2
  exit 1
fi

for subdir in "$@"; do
  seed="$SEED_ROOT/$subdir"
  target="$TARGET_ROOT/$subdir"

  if [ ! -d "$seed" ]; then
    echo "seed-assets: FATAL missing seed source $seed" >&2
    exit 1
  fi

  if ! mkdir -p "$target"; then
    echo "seed-assets: FATAL cannot create $target" >&2
    exit 1
  fi

  cp -Rn "$seed/." "$target/" 2>/dev/null || true

  expected=$(cd "$seed" && find . -type f | wc -l | tr -d ' ')
  missing=$(cd "$seed" && find . -type f -print | while IFS= read -r file; do
    [ -e "$target/$file" ] || printf '%s\n' "$file"
  done)

  if [ -n "$missing" ]; then
    echo "seed-assets: FATAL $subdir did not seed. Missing from $target:" >&2
    printf '%s\n' "$missing" | sed 's/^/  /' >&2
    exit 1
  fi

  echo "seed-assets: $subdir ok ($expected tracked file(s) present in $target)"
done
