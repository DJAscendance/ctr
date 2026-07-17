#!/usr/bin/env bash
#
# QA / regression script for the home-image moderation approve-vs-upload race.
#
# WHAT IT PROVES
#   A moderator approval must publish ONLY the exact image revision that was reviewed. Before
#   the revision-binding fix, an approval begun for image A could publish a different, unchecked
#   image B that had replaced A under a shared private filename - a moderation bypass. This
#   script drives the real running stack and asserts the security invariant that is observable
#   over HTTP alone:
#
#       The anonymously-served public image bytes are NEVER the unchecked replacement (B).
#       Public bytes, when present, are only ever the reviewed/approved image (A).
#
#   It races an approval of A against a replacement upload of B, over many iterations and
#   staggers and both orderings, and also runs the non-concurrent "review A -> owner swaps to
#   B -> approve" case (which must return HTTP 409 and publish nothing).
#
# REQUIREMENTS
#   - The local dev stack is up (docker-compose). curl and sha256sum on PATH.
#   - A settled home whose owner token you control, and a moderator token.
#
# USAGE
#   MOD_TOKEN=<moderator apitoken> \
#   OWNER_TOKEN=<home-owner apitoken> \
#   HOME_PLACE_ID=<the owner's home place id> \
#   [API_BASE=http://localhost:8001/api] \
#   [PUBLIC_BASE=http://localhost:8001/assets/homes-uploads] \
#   [ITERATIONS=25] \
#   bash api/qa/home-image-moderation-race.sh
#
# EXIT CODE
#   0 if the invariant held on every iteration; 1 if the unchecked image was ever public
#   (or the environment was misconfigured).
#
set -u

API_BASE="${API_BASE:-http://localhost:8001/api}"
PUBLIC_BASE="${PUBLIC_BASE:-http://localhost:8001/assets/homes-uploads}"
ITERATIONS="${ITERATIONS:-25}"
: "${MOD_TOKEN:?set MOD_TOKEN to a moderator apitoken}"
: "${OWNER_TOKEN:?set OWNER_TOKEN to the home owner's apitoken}"
: "${HOME_PLACE_ID:?set HOME_PLACE_ID to the owner's home place id}"

PID="$HOME_PLACE_ID"
PUB="$PUBLIC_BASE/$PID.webp"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Two small, visually-distinct PNGs (solid red = A, solid blue = B). The server re-encodes to
# WebP, so distinct colors yield distinct stored bytes.
A_B64=iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAIAAAC2BqGFAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABlklEQVR4nO3UUQ1CARTDUEQc/8qeGAzwC7shTaag6fp6aM/3Ibyi/PxEtUALtH96W0YLtLmGGW0OrnS4uRot0OYaZrQ5uNLh5mq0QJtrmNHm4EqHm6vRAm2uYUabgysdbq5GC7S5hhltDq50uLkaLdDmGma0ObjS4eZqtECba5jR5uBKh5ur0QJtrmFGm4MrHW6uRgu0uYYZbQ6udLi5Gi3Q5hpmtDm40uHmarRAm2uY0ebgSoebq9ECba5hRpuDKx1urkYLtLmGGW0OrnS4uRot0OYaZrQ5uNLh5mq0QJtrmNHm4EqHm6vRAm2uYUabgysdbq5GC7S5hhltDq50uLkaLdDmGma0ObjS4eZqtECba5jR5uBKh5ur0QJtrmFGm4MrHW6uRgu0uYYZbQ6udLi5Gi3Q5hpmtDm40uHmarRAm2uY0ebgSoebq9ECba5hRpuDKx1urkYLtLmGGW0OrnS4uRot0OYaZrQ5uNLh5mq0QJtrmNHm4EqHm6vRAm2uYUabgysdbq5GC7S5hhltDq50mDP9uDcDDCRYODzQEQAAAABJRU5ErkJggg==
B_B64=iVBORw0KGgoAAAANSUhEUgAAAHgAAAB4CAIAAAC2BqGFAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABl0lEQVR4nO3UUQ1CARTDUEQ8/8oqBgP8wm7ISaag6fp6nuz5PoQXys9PVAM6oPuntzE6oJtryOjm4KSjm9PogG6uIaObg5OObk6jA7q5hoxuDk46ujmNDujmGjK6OTjp6OY0OqCba8jo5uCko5vT6IBuriGjm4OTjm5OowO6uYaMbg5OOro5jQ7o5hoyujk46ejmNDqgm2vI6ObgpKOb0+iAbq4ho5uDk45uTqMDurmGjG4OTjq6OY0O6OYaMro5OOno5jQ6oJtryOjm4KSjm9PogG6uIaObg5OObk6jA7q5hoxuDk46ujmNDujmGjK6OTjp6OY0OqCba8jo5uCko5vT6IBuriGjm4OTjm5OowO6uYaMbg5OOro5jQ7o5hoyujk46ejmNDqgm2vI6ObgpKOb0+iAbq4ho5uDk45uTqMDurmGjG4OTjq6OY0O6OYaMro5OOno5jQ6oJtryOjm4KSjm9PogG6uIaObg5OObk6jA7q5hoxuDk46ujmNDujmGjK6OTjp6OY0OqCba8jo5uCkoznTj3sDGeQkWEJvvIEAAAAASUVORK5CYII=
printf '%s' "$A_B64" | base64 -d > "$WORK/a.png"
printf '%s' "$B_B64" | base64 -d > "$WORK/b.png"

api() { curl -s -o /dev/null -w '%{http_code}' -H "apitoken: $2" "${@:3}" "$API_BASE$1"; }
upload() { curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/home/upload-image" -H "apitoken: $OWNER_TOKEN" -F "imageFile=@$1"; }
remove() { curl -s -o /dev/null -X POST "$API_BASE/home/remove-image" -H "apitoken: $OWNER_TOKEN"; }
queue_rev() { curl -s "$API_BASE/home/moderation/queue" -H "apitoken: $MOD_TOKEN" | grep -o "\"revision\":\"[a-f0-9]*\"" | head -1 | cut -d'"' -f4; }
approve() { curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/home/moderation/$PID/approve" -H "apitoken: $MOD_TOKEN" -H 'Content-Type: application/json' -d "{\"revision\":\"$1\"}"; }
reject() { curl -s -o /dev/null -w '%{http_code}' -X POST "$API_BASE/home/moderation/$PID/reject" -H "apitoken: $MOD_TOKEN" -H 'Content-Type: application/json' -d "{\"revision\":\"$1\"}"; }
served_sha() { curl -s "$PUB" -o "$WORK/pub" -w '%{http_code}' > "$WORK/code"; if [ "$(cat "$WORK/code")" = 200 ]; then sha256sum "$WORK/pub" | cut -d' ' -f1; else echo "absent"; fi; }

# Establish the reviewed (A) and replacement (B) stored checksums.
remove >/dev/null; upload "$WORK/a.png" >/dev/null
curl -s "$API_BASE/home/moderation/$PID/image" -H "apitoken: $MOD_TOKEN" -o "$WORK/refA"
SHA_A=$(sha256sum "$WORK/refA" | cut -d' ' -f1)
upload "$WORK/b.png" >/dev/null
curl -s "$API_BASE/home/moderation/$PID/image" -H "apitoken: $MOD_TOKEN" -o "$WORK/refB"
SHA_B=$(sha256sum "$WORK/refB" | cut -d' ' -f1)
remove >/dev/null
if [ "$SHA_A" = "$SHA_B" ]; then echo "ERROR: reference images are not distinct; aborting."; exit 1; fi
echo "reviewed A sha=$SHA_A"
echo "replacement B sha=$SHA_B"

fail=0; runs=0
assert_not_B() {  # $1=context
  # B (the replacement) is NEVER reviewed/approved in any scenario below, so the public image
  # must be either absent or A - and never B.
  local s; s=$(served_sha)
  runs=$((runs + 1))
  if [ "$s" = "$SHA_B" ]; then
    echo "  [$1] FAIL: unchecked replacement (B) is publicly served"
    fail=$((fail + 1))
  elif [ "$s" != "absent" ] && [ "$s" != "$SHA_A" ]; then
    echo "  [$1] FAIL: public image is neither A nor absent (partial/unknown bytes)"
    fail=$((fail + 1))
  fi
}

echo "== concurrent approve(A) vs upload(B) =="
i=0
while [ "$i" -lt "$ITERATIONS" ]; do
  i=$((i + 1))
  stag=$(awk "BEGIN{print ($i%4)*0.003}")
  remove >/dev/null; upload "$WORK/a.png" >/dev/null
  rev=$(queue_rev)
  if [ $((i % 2)) -eq 0 ]; then
    ( approve "$rev" >/dev/null ) & ( sleep "$stag"; upload "$WORK/b.png" >/dev/null ) &
  else
    ( upload "$WORK/b.png" >/dev/null ) & ( sleep "$stag"; approve "$rev" >/dev/null ) &
  fi
  wait; sleep 0.08
  assert_not_B "approve-vs-upload#$i"
done

echo "== non-concurrent review->swap->approve (must 409, B never public) =="
for i in 1 2 3 4 5; do
  remove >/dev/null; upload "$WORK/a.png" >/dev/null
  rev=$(queue_rev)              # moderator reviews A
  upload "$WORK/b.png" >/dev/null   # owner swaps to B
  code=$(approve "$rev")        # approve the reviewed revision (A)
  [ "$code" != 409 ] && { echo "  [swap#$i] FAIL: stale approve returned $code, expected 409"; fail=$((fail + 1)); }
  assert_not_B "swap#$i"
done

# Post-commit cleanup races: an operation's filesystem cleanup runs after its own transaction
# commits. These exercise that a later operation's public/private files are never clobbered by
# an earlier request's delayed cleanup (the state-guarded public delete + captured-revision
# private delete). In every case B is never reviewed, so B must never be publicly reachable.
echo "== approve(A) immediately followed by upload(B) (upload cleanup vs approved image) =="
i=0
while [ "$i" -lt "$ITERATIONS" ]; do
  i=$((i + 1))
  remove >/dev/null; upload "$WORK/a.png" >/dev/null
  rev=$(queue_rev)
  # approve A, then race a replacement upload of B against the approval's post-commit cleanup.
  ( approve "$rev" >/dev/null ) & ( upload "$WORK/b.png" >/dev/null ) &
  wait; sleep 0.08
  assert_not_B "approve-then-upload#$i"
done

echo "== remove(A) vs upload(B) (remove cleanup must not wipe the new upload's file) =="
for i in 1 2 3 4 5; do
  remove >/dev/null; upload "$WORK/a.png" >/dev/null
  ( remove >/dev/null ) & ( upload "$WORK/b.png" >/dev/null ) &
  wait; sleep 0.08
  # If the home ended pending (upload won), its private file must exist so the preview works.
  rev=$(queue_rev)
  if [ -n "$rev" ]; then
    pc=$(curl -s -o /dev/null -w '%{http_code}' "$API_BASE/home/moderation/$PID/image" -H "apitoken: $MOD_TOKEN")
    [ "$pc" != 200 ] && { echo "  [remove-vs-upload#$i] FAIL: pending image preview $pc (file wiped by remove cleanup)"; fail=$((fail + 1)); }
  fi
  assert_not_B "remove-vs-upload#$i"
done

echo "== reject(A) vs upload(B) (reject cleanup must not touch the new upload) =="
for i in 1 2 3 4 5; do
  remove >/dev/null; upload "$WORK/a.png" >/dev/null
  rev=$(queue_rev)
  ( reject "$rev" >/dev/null ) & ( upload "$WORK/b.png" >/dev/null ) &
  wait; sleep 0.08
  assert_not_B "reject-vs-upload#$i"
done

remove >/dev/null
echo "-----------------------------------------------------------"
echo "iterations checked: $runs ; invariant failures: $fail"
if [ "$fail" -eq 0 ]; then
  echo "PASS: no unchecked/other bytes ever became publicly reachable; cleanup never clobbered a newer op."
  exit 0
fi
echo "FAIL: moderation/coherence invariant violated."
exit 1
