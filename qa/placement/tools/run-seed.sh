#!/usr/bin/env bash
# Seeds the placement fixture set into a disposable QA database.
#
# Refuses to run against anything that looks like a real deployment: the guard
# below aborts if the member table is larger than a dev seed, or if any
# non-fixture object_instance already carries placement data beyond the handful
# the QA seed ships with.
set -euo pipefail

CONTAINER="${CTR_QA_DB_CONTAINER:-xite162qa-db-1}"
DATABASE="${CTR_QA_DB_NAME:-cybertown}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

mysql_run() {
  docker exec -i "$CONTAINER" sh -c \
    "mysql -uroot -p\"\$MYSQL_ROOT_PASSWORD\" --batch --skip-column-names $DATABASE" 2>/dev/null
}

members=$(echo "SELECT COUNT(*) FROM member;" | mysql_run)
if [ "$members" -gt 25 ]; then
  echo "REFUSING: $DATABASE has $members members; this is not a disposable QA database." >&2
  exit 1
fi

placed=$(echo "SELECT COUNT(*) FROM object_instance oi JOIN object o ON o.id = oi.object_id
  WHERE oi.position IS NOT NULL AND o.name NOT LIKE 'QAFIX %';" | mysql_run)
if [ "$placed" -gt 5 ]; then
  echo "REFUSING: $DATABASE holds $placed non-fixture placed objects; seed elsewhere." >&2
  exit 1
fi

case "${1:-seed}" in
  seed)  node "$HERE/seed-fixtures.js" | mysql_run ;;
  purge) node "$HERE/seed-fixtures.js" --purge | mysql_run ;;
  *) echo "usage: run-seed.sh [seed|purge]" >&2; exit 2 ;;
esac
echo "$1 complete"
