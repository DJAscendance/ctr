#!/bin/bash
# Release preflight for the CTR beta stack: verify this release is operating on the intended
# Beta application, then bring the schema up to date WHILE THE PREVIOUS RELEASE IS STILL
# SERVING, and abort the release if either step fails.
#
# This is Coolify's "Custom Build Command" for the ctr-beta application. That field is not
# an arbitrary choice of hook -- it is the only one that runs in the right place. Reading
# Coolify 4.1.2's app/Jobs/ApplicationDeploymentJob.php::deploy_docker_compose_buildpack(),
# a compose release happens in this order:
#
#   635  prepare_builder_image()        -- ends by running pre_deployment_command
#   637  clone_repository()             -- the NEW release lands in the builder container
#   713  save_buildtime_environment_variables()  -- writes /artifacts/build-time.env
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
# WHAT IDENTIFIES THE TARGET
#
# The revision before this one selected the database with nothing but
# COMPOSE_PROJECT_NAME + service=db, and took `head -n 1` of the result. A compose project
# name is a plain string supplied by the deployment field; a typo that happens to name
# ANOTHER EXISTING PROJECT with a `db` service silently migrated that project's database and
# exited 0. Wrong database, wrong schema, green deployment. That is the defect this revision
# closes, and it is why every check below is an equality against Docker's own labels rather
# than a search that settles for the first hit.
#
# Coolify 4.1.2 stamps four identity labels onto every container it manages (verified by
# `docker inspect` on the live beta containers, and on the unrelated ctng-site application
# beside them, which carries coolify.applicationId=2 / coolify.resourceName=ctng-site):
#
#   coolify.applicationId   the Coolify applications.id row -- 1 for ctr-beta. Immutable:
#                           it survives redeploy, rename and image change, and a second
#                           application cannot share it.
#   coolify.resourceName    the application name -- ctr-beta.
#   coolify.projectName     the Coolify project -- ctng. Shared with ctng-site, so it is a
#                           corroborating field, not an identifying one.
#   coolify.environmentName production.
#
# com.docker.compose.project is the application uuid (zkoil3p3wo2mozpn833yu2ol), which is
# stable too -- but it is the ONE field the deployment types in by hand, so it is exactly the
# field that can be wrong. It is checked, and it is never checked alone.
#
# The expected values are declared by the deployment command and compared with what Docker
# reports. Coolify does not export them: generate_coolify_env_variables() only emits
# COOLIFY_RESOURCE_UUID when the build pack is not `dockercompose` or the compose parsing
# version is 1 or 2 (ctr-beta is dockercompose at version 5). So the command states the
# identity and this script proves it -- rather than trusting a name Coolify never actually
# passes. SOURCE_COMMIT is the one value that must come from Coolify, because the checkout
# has no .git by the time this runs; see the release identity block below. It requires
# application_settings.include_source_commit_in_build to be ON. See docs/beta-deployment.md
# for the exact command.
#
# What this script may do is deliberately narrow:
#   * prove the identity of the target application, the release checkout and the database.
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

log()  { echo "== preflight: $* =="; }
fail() { echo "preflight: $*" >&2; exit 1; }

# ------------------------------------------------------- phase 0: identity
# Every check in this phase runs BEFORE anything is built and long before anything is
# migrated, and every one of them exits non-zero rather than falling back to a guess.

# --- release identity -------------------------------------------------------------
# THERE IS NO GIT REPOSITORY HERE. Coolify deletes it: deploy_docker_compose_buildpack()
# calls cleanup_git() at ApplicationDeploymentJob.php:663, which runs `rm -fr {basedir}/.git`,
# fifty lines before it runs this script at line 715. `git rev-parse HEAD` cannot work in
# this directory and never will on this Coolify version -- it is not a misconfiguration to
# fix, it is the shape of the build step. Proven live on 2026-09-12 by deployment
# cf2a0130-8306-4920-9751-43ec9efae08d, which died on the first gate of the previous version
# of this block while the old release kept serving.
#
# The release sha therefore comes from Coolify, the only party here that still knows it.
# save_buildtime_environment_variables() writes the build-time environment to
# /artifacts/build-time.env at line 713 -- the step immediately before this one -- and that
# file carries SOURCE_COMMIT when application_settings.include_source_commit_in_build is on.
# The shell environment is NOT a second source: the custom-build branch at 715 does not
# prepend $coolify_variables (only the default branch at 758 does), and the helper container
# is restarted with the resolved commit only when use_build_secrets is on. So the file is
# read directly, and SOURCE_COMMIT from the environment is accepted only as an override for
# running this script outside Coolify.
#
# This is a real reduction in strength and it is recorded as one. The old block computed the
# sha from the working tree and used SOURCE_COMMIT only as a claim to check against it.
# Nothing in this directory can do that any more, so the sha is now Coolify's word for it.
# It is used for logging and for tagging the migration image; no identity gate below depends
# on it. The gates that decide whether a database may be migrated are the application,
# network and schema proofs, and every one of those is still measured here, not supplied.
BUILD_TIME_ENV="${CTR_BETA_BUILD_TIME_ENV:-/artifacts/build-time.env}"

release_sha="${SOURCE_COMMIT:-}"
if [ -z "$release_sha" ] && [ -r "$BUILD_TIME_ENV" ]; then
  # Last assignment wins, surrounding quotes stripped: the file is KEY=value per line as
  # Coolify's base64 blob decodes, and a later duplicate is the one a reader would honour.
  release_sha="$(sed -n 's/^SOURCE_COMMIT=//p' "$BUILD_TIME_ENV" | tail -n 1 | tr -d "\"'")"
fi
if [ -z "$release_sha" ]; then
  fail "no release sha: SOURCE_COMMIT is unset and ${BUILD_TIME_ENV} does not carry it.
 Turn on 'Include SOURCE_COMMIT in build' for the ctr-beta application in Coolify."
fi
# Forty lowercase hex characters or nothing. Coolify writes the literal 'HEAD' or 'unknown'
# when it has not resolved the commit, and neither may be tagged onto an image as a release.
case "$release_sha" in
  *[!0-9a-f]*) fail "SOURCE_COMMIT=${release_sha} is not a hex commit sha." ;;
esac
[ "${#release_sha}" -eq 40 ] \
  || fail "SOURCE_COMMIT=${release_sha} is not a full 40-character commit sha."
RELEASE_SHA="$release_sha"
log "release sha ${RELEASE_SHA}, from the Coolify build-time environment"

# --- repository identity ----------------------------------------------------------
# A different repository with a file at this path must not be able to migrate beta. The root
# commit was the old proof and it needed git, which is gone for the reason above. The
# replacement is the repository's own first migration. Its name is as fixed as a commit id,
# and for a stronger reason than convention: knex records applied migrations by filename, so
# every existing CTR database -- beta's included -- holds this exact string in its
# `migrations` table. Renaming it in the repository would make knex treat it as a new
# migration and re-run init_schema against a populated database, so it cannot be changed. It
# is specific to this history, and unlike the root commit it is readable from the working
# tree alone.
#
# It is a weaker proof than the root commit: it is a path, and a hostile repository that set
# out to satisfy it could create that path. It is not the last line of defence -- a checkout
# that passes here still has to match the application labels, resolve to exactly one database
# container under that identity, share exactly one network with it, and agree with
# MYSQL_DATABASE, before a single migration runs.
CTR_ROOT_MIGRATION="${CTR_ROOT_MIGRATION:-api/db/migrations/20220521061146_init_schema.ts}"
[ -f "$CTR_ROOT_MIGRATION" ] \
  || fail "this checkout has no ${CTR_ROOT_MIGRATION}, so it is not a CTR repository;
 refusing to migrate beta."

# --- application identity ---------------------------------------------------------
# All three are required and none of them has a default. A missing one is a deployment that
# has not said what it is aiming at, and that is not a state to guess from.
: "${COMPOSE_PROJECT_NAME:?set COMPOSE_PROJECT_NAME to the compose project of the target stack}"
: "${CTR_BETA_APPLICATION_ID:?set CTR_BETA_APPLICATION_ID to the target coolify.applicationId label}"
: "${CTR_BETA_RESOURCE_NAME:?set CTR_BETA_RESOURCE_NAME to the target coolify.resourceName label}"
PROJECT="$COMPOSE_PROJECT_NAME"

# `docker ps -a`, not `docker ps`: a database that is restarting, or briefly down, is a
# database to WAIT for, not a reason to abort a release. A stopped container still reports
# its labels and its networks and rejoins them when it starts, so identity resolves either
# way, and migrate-db.sh then waits up to 120s for MySQL to answer.
find_containers() {
  docker ps -aq \
    --filter "label=com.docker.compose.project=${PROJECT}" \
    --filter "label=coolify.applicationId=${CTR_BETA_APPLICATION_ID}" \
    --filter "label=coolify.resourceName=${CTR_BETA_RESOURCE_NAME}" \
    --filter "label=com.docker.compose.service=$1"
}

# Exactly one. Zero is a wrong project, a wrong identity or a stack that was never
# bootstrapped; more than one is an ambiguity, and an ambiguity resolved by `head -n 1` is
# how the wrong database gets migrated. Both stop the release.
db_matches="$(find_containers db)"
db_count="$(printf '%s' "$db_matches" | grep -c . || true)"
if [ "$db_count" -ne 1 ]; then
  echo "preflight: expected exactly 1 db container for the target application, found ${db_count}." >&2
  echo "preflight:   com.docker.compose.project = ${PROJECT}" >&2
  echo "preflight:   coolify.applicationId      = ${CTR_BETA_APPLICATION_ID}" >&2
  echo "preflight:   coolify.resourceName       = ${CTR_BETA_RESOURCE_NAME}" >&2
  [ "$db_count" -eq 0 ] \
    && echo "preflight: no database carries all three labels. Check the deployment command,\
 or bootstrap first (docs/beta-deployment.md)." >&2 \
    || echo "preflight: refusing to choose between ${db_count} candidates." >&2
  exit 1
fi
db_container="$db_matches"

# The rest of the application, by the same identity. This is what makes a lone database
# belonging to some other stack insufficient: a database is only beta's if beta's API,
# socket and web tier are standing next to it under the same application labels.
declare -A peer_container=()
for svc in ct-api ct-socket nginx; do
  matches="$(find_containers "$svc")"
  count="$(printf '%s' "$matches" | grep -c . || true)"
  [ "$count" -ge 1 ] \
    || fail "no ${svc} container carries the target application identity;\
 this database is not part of the expected beta stack."
  peer_container[$svc]="$(printf '%s\n' "$matches" | head -n 1)"
done
log "application identity verified: project=${PROJECT}\
 applicationId=${CTR_BETA_APPLICATION_ID} resourceName=${CTR_BETA_RESOURCE_NAME}"

# --- network identity -------------------------------------------------------------
# Coolify does not deploy this compose file as written: it rewrites it onto an external
# network named after the application uuid, so `compose run` here would land on
# "<project>_default", find no `db` and time out against a database that was healthy the
# whole time. The migrator must join the network the LIVE database is already on.
#
# Which one, when a container can be on several, is an identity question rather than an
# ordering one -- the old `head -n 1` would happily have picked a shared or external network.
# The answer is the network beta's database and beta's API both sit on: nothing else can
# carry the migrator to the right mysqld. Coolify's network carries no labels of its own
# (verified on the live host), so this intersection is the available proof, and more than one
# answer is an ambiguity, not a choice.
networks_of() {
  docker inspect --format '{{range $n, $_ := .NetworkSettings.Networks}}{{$n}}{{"\n"}}{{end}}' "$1" \
    | grep . | sort -u
}
shared_networks="$(comm -12 \
  <(networks_of "$db_container") \
  <(networks_of "${peer_container[ct-api]}"))"
network_count="$(printf '%s' "$shared_networks" | grep -c . || true)"
[ "$network_count" -eq 1 ] \
  || fail "expected exactly 1 network shared by the beta db and ct-api,\
 found ${network_count}; refusing to pick one."
NETWORK="$shared_networks"

# --- database identity ------------------------------------------------------------
# Coolify writes the application's environment here before the build command runs
# (ApplicationDeploymentJob::BUILD_TIME_ENV_PATH, written by
# save_buildtime_environment_variables() at line 713 -- two lines before this script). The
# values are shell-escaped by Coolify for exactly this kind of consumption. Overridable so a
# local rehearsal can point at its own file.
ENV_FILE="${PREFLIGHT_ENV_FILE:-/artifacts/build-time.env}"
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

# The schema name the running database was created with, read from the container rather than
# from the file this release happens to ship. It is a consistency check on top of an identity
# that is already established -- NOT the identity itself, because any CTR stack would answer
# `cybertown` here. Migrating a verified beta database under a name it does not have would
# create a second, empty schema beside the citizens.
db_schema="$(docker inspect --format \
  '{{range .Config.Env}}{{if (eq (index (split . "=") 0) "MYSQL_DATABASE")}}{{index (split . "=") 1}}{{end}}{{end}}' \
  "$db_container")"
[ -n "$db_schema" ] || fail "db container ${db_container} declares no MYSQL_DATABASE."
[ "$db_schema" = "$DB_DATABASE" ] \
  || fail "the target database was created as '${db_schema}'\
 but this release would migrate '${DB_DATABASE}'."

log "target verified: db=${db_container} schema=${db_schema} network=${NETWORK}"

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
# cannot be the wrong build. The tag is the CHECKOUT sha, so what is recorded is what was
# compiled -- not what a caller said it was.
MIGRATE_IMAGE_ID="$(docker image inspect --format '{{.Id}}' ctr-beta-tooling)"
docker image tag "$MIGRATE_IMAGE_ID" "ctr-beta-tooling:${RELEASE_SHA}"
log "migration image ${MIGRATE_IMAGE_ID} tagged ctr-beta-tooling:${RELEASE_SHA}"

# ------------------------------------------------------- phase 2: migrate, in place
# `migrate-db` is named explicitly. The tooling image's default CMD is `bootstrap-db`, which
# seeds and refuses a populated database; naming the command is what keeps the seeding path
# unreachable from a release. --rm so a failed attempt leaves no container to be mistaken for
# a completed one by the next release.
#
# migrate-db.sh waits up to 120s for the database and exits non-zero if it never arrives, so
# a slow database is waited out and an absent one fails the release instead of hanging it.
log "migrating on network ${NETWORK} against db container ${db_container}"
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
