#!/bin/bash
# Release preflight for the CTR beta stack: build the release, then bring the schema up to
# date WHILE THE PREVIOUS RELEASE IS STILL SERVING, and abort the release if that fails.
#
# This is Coolify's "Custom Build Command" for the ctr-beta application. That field is not
# an arbitrary choice of hook -- it is the only one that runs in the right place. Reading
# Coolify 4.1.2's app/Jobs/ApplicationDeploymentJob.php::deploy_docker_compose_buildpack(),
# a compose release happens in this order:
#
#   635  prepare_builder_image()        -- ends by running pre_deployment_command
#   637  clone_repository()             -- the NEW release lands in the builder container
#   715  docker_compose_custom_build_command   <-- THIS SCRIPT
#   782  stop_running_container(force: true)   <-- the old release is destroyed here
#   806  docker_compose_custom_start_command / start_by_compose_file()
#
# Only line 715 is both after the new code exists and before the old containers die, and a
# non-zero exit there throws DeploymentException, so the release stops with line 782 never
# reached and the old API, socket and nginx still serving. The alternatives were measured
# against that and rejected:
#
#   * pre_deployment_command (line 635) runs `docker exec` into the CURRENTLY RUNNING
#     container -- the OLD image. It cannot run the new release's migration files, which is
#     the entire point, and it silently skips itself when no container is running.
#   * custom start command (806) and post_deployment_command both run after line 782: the
#     old release is already gone, so a failure there is an outage, and a migration there is
#     new code meeting an old schema.
#
# The previous revision instead made ct-api `depends_on` a ct-migrate service with
# `condition: service_completed_successfully`. The ordering was right and the availability
# was wrong: `up` runs at line 806, so a failed migration failed with the old containers
# already destroyed at 782 and the new ones refusing to start. Schema safety, total outage.
#
# What this script may do is deliberately narrow:
#   * build the release images.
#   * run migrations, once, via docker/beta/migrate-db.sh.
# It never starts, stops, recreates or touches ct-api, ct-socket or nginx -- replacing the
# application is Coolify's job, after this script has returned 0. It never seeds, never
# bootstraps, never resets: `migrate-db` is the only command it can reach, and the
# bootstrap's default CMD is never invoked.
#
# Because the schema is updated while the OLD code is still serving it, a migration in a
# release must be backward compatible with the release before it -- expand first, contract
# in a later release. See docs/beta-deployment.md.
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.beta.yml}"

# The compose project of the RUNNING stack. Coolify names it after the application uuid and
# passes it to its own compose calls as --project-name; it is not exported into this shell,
# so the deployment command must set it. Getting it wrong would migrate nothing and, worse,
# start a second stack beside the live one, so there is no default.
: "${COMPOSE_PROJECT_NAME:?set COMPOSE_PROJECT_NAME to the compose project of the running stack}"
PROJECT="$COMPOSE_PROJECT_NAME"

# Coolify writes the application's environment here before the build command runs
# (ApplicationDeploymentJob::BUILD_TIME_ENV_PATH, written by
# save_buildtime_environment_variables() at line 713 -- two lines before this script). The
# values are shell-escaped by Coolify for exactly this kind of consumption. Overridable so a
# local rehearsal can point at its own file.
ENV_FILE="${PREFLIGHT_ENV_FILE:-/artifacts/build-time.env}"

RELEASE_SHA="${SOURCE_COMMIT:-$(git rev-parse HEAD 2>/dev/null || echo unknown)}"

log() { echo "== preflight: $* =="; }

if [ -f "$ENV_FILE" ]; then
  log "loading environment from $ENV_FILE"
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
else
  log "no env file at $ENV_FILE, using the inherited environment"
fi

: "${DB_USER:?DB_USER must be set (expected from $ENV_FILE)}"
: "${DB_PASS:?DB_PASS must be set (expected from $ENV_FILE)}"
DB_DATABASE="${DB_DATABASE:-cybertown}"

compose() { docker compose -f "$COMPOSE_FILE" --project-name "$PROJECT" "$@"; }

# ---------------------------------------------------------------- phase 1: build
# --pull matches the build Coolify performs when no custom build command is set, so taking
# this field over does not quietly change how base images are resolved. --profile migrate is
# what includes ct-migrate; without it the tooling image this script is about to run would
# not be built at all.
log "building release $RELEASE_SHA"
compose --profile migrate build --pull

# The image the migration will run as, resolved by ID the instant after it is built, and run
# by that ID below. `ctr-beta-tooling` is a fixed tag and a fixed tag is exactly how a
# preflight ends up executing last release's migration files; an image ID captured here
# cannot be the wrong build.
MIGRATE_IMAGE_ID="$(docker image inspect --format '{{.Id}}' ctr-beta-tooling)"
docker image tag "$MIGRATE_IMAGE_ID" "ctr-beta-tooling:${RELEASE_SHA}"
log "migration image ${MIGRATE_IMAGE_ID} tagged ctr-beta-tooling:${RELEASE_SHA}"

# ------------------------------------------------------- phase 2: migrate, in place
# Attach the migrator to the network the LIVE database is already on, rather than to
# whatever network this compose file would create. Coolify does not deploy this file as
# written: it rewrites it onto an external network named after the application uuid, so a
# plain `compose run` here would land on "<project>_default", find no `db` and time out
# against a database that was healthy the whole time. Asking the running container is also
# simply the honest question -- migrate against the database the old release is serving.
#
# `docker ps -a`, not `docker ps`: a database that is restarting, or briefly down, is a
# database to WAIT for, not a reason to abort a release. A stopped container still reports
# the network it is attached to and rejoins it when it starts, so this resolves the right
# network either way, and migrate-db.sh then waits up to 120s for MySQL to answer -- a slow
# or restarting database is waited out, one that never returns fails the release. What is
# still fatal is NO container at all, which is a different thing entirely: a wrong
# COMPOSE_PROJECT_NAME, or a stack that was never bootstrapped.
db_container="$(docker ps -aq \
  --filter "label=com.docker.compose.project=${PROJECT}" \
  --filter "label=com.docker.compose.service=db" | head -n 1)"

if [ -z "$db_container" ]; then
  # Deliberately fatal, and deliberately not "start one". This script only ever runs as part
  # of replacing a running release, and that release has a database; `restart: unless-stopped`
  # and a named volume mean a missing one is a fault to look at, not a state to paper over.
  #
  # Starting it here would also be wrong rather than merely eager: Coolify does not deploy
  # this compose file as written, it rewrites it onto an external network, so a db started
  # from this file lands on "<project>_default" and the release that follows would create a
  # SECOND database on the real network -- an empty one, beside the migrated one, with the
  # citizen data in whichever the application did not pick. Bringing up a first database is
  # the bootstrap's job; see docs/beta-deployment.md.
  echo "preflight: no db container at all for compose project ${PROJECT}." >&2
  echo "preflight: this script migrates a live stack and will not create one." >&2
  echo "preflight: check COMPOSE_PROJECT_NAME, or bootstrap first (docs/beta-deployment.md)." >&2
  exit 1
fi

NETWORK="${PREFLIGHT_NETWORK:-$(docker inspect --format \
  '{{range $name, $_ := .NetworkSettings.Networks}}{{$name}}{{"\n"}}{{end}}' \
  "$db_container" | head -n 1)}"
[ -n "$NETWORK" ] || { echo "preflight: db container ${db_container} is on no network" >&2; exit 1; }
log "migrating on network ${NETWORK} against db container ${db_container}"

# `migrate-db` is named explicitly. The tooling image's default CMD is `bootstrap-db`, which
# seeds and refuses a populated database; naming the command is what keeps the seeding path
# unreachable from a release. --rm so a failed attempt leaves no container to be mistaken for
# a completed one by the next release.
#
# migrate-db.sh waits up to 120s for the database and exits non-zero if it never arrives, so
# a slow database is waited out and an absent one fails the release instead of hanging it.
docker run --rm \
  --network "$NETWORK" \
  -e NODE_ENV=production \
  -e DB_HOST=db \
  -e DB_PORT=3306 \
  -e DB_USER="$DB_USER" \
  -e DB_PASS="$DB_PASS" \
  -e DB_DATABASE="$DB_DATABASE" \
  "$MIGRATE_IMAGE_ID" migrate-db

log "schema is up to date; release $RELEASE_SHA may proceed"
