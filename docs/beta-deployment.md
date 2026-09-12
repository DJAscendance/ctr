# CTR beta deployment — schema migrations

How a beta release brings the database schema up to date, and why it does it *before* it
touches the running site.

## Why this exists

Two incidents, not one.

**New code, old schema.** The 2026-09-11 Outlands release put new application code on beta
while the schema stayed one migration behind. Nothing in the deployment path ran
`knex migrate:latest`. Migration 49 was applied by hand, afterwards, against a database that
had already been serving the new code.

**The first fix took the site down instead.** The obvious repair — make `ct-api` wait on a
`ct-migrate` service with `condition: service_completed_successfully` — gets the *ordering*
right and the *availability* wrong. Coolify force-stops the running containers before it runs
`compose up` (`ApplicationDeploymentJob::deploy_docker_compose_buildpack()`:
`stop_running_container` at line 782, `start_by_compose_file` at line 806). A migration that
failed inside `up` therefore failed with the old API, socket and nginx already destroyed and
the new ones refusing to start. Measured on a disposable stack: `service "ct-migrate" didn't
complete successfully: exit 1`, and nginx/ct-api/ct-socket all gone, with no automatic
recovery. A bad migration must cancel its own release, not the site.

## The two-phase release

```
   OLD RELEASE HEALTHY AND SERVING
              |
              v
   [715] MIGRATION PREFLIGHT  ── docker/beta/release-preflight.sh
     build the new release's images
     run its migrations against the live database
              |
        +-----+-----+
        |           |
      FAIL        PASS
        |           |
        v           v
   RELEASE      [782] stop old containers
   ABORTED      [806] start new containers
        |
   OLD RELEASE STILL SERVING
   (nothing was stopped)
```

Phase 1 runs as Coolify's **Custom Build Command**. That field is not an arbitrary choice: it
is the only hook that runs both *after* the new release is cloned and *before* the old
containers are stopped. The alternatives were checked against Coolify 4.1.2's own source and
rejected:

| Hook | Runs | Verdict |
|---|---|---|
| `pre_deployment_command` | line 635, via `docker exec` into the **currently running** container | Rejected — that is the OLD image. It cannot run the new release's migration files, and it silently skips itself when no container is running. |
| **`docker_compose_custom_build_command`** | line 715, in the builder container, on the **cloned new release** | **Selected.** Before line 782; a non-zero exit throws `DeploymentException` and the release stops. |
| `docker_compose_custom_start_command` | line 806 | Rejected — the old release is already destroyed at 782. |
| `post_deployment_command` | after the new containers are up | Rejected — that is new code meeting an old schema again. |

### Required Coolify configuration

On the `ctr-beta` application, set **Custom Build Command** to:

```
COMPOSE_PROJECT_NAME=zkoil3p3wo2mozpn833yu2ol CTR_BETA_APPLICATION_ID=1 CTR_BETA_RESOURCE_NAME=ctr-beta bash ./docker/beta/release-preflight.sh
```

Leave **Custom Start Command** empty. Coolify's own `compose up` is the application rollout.

### Required application identity

All three values are required, none has a default, and an empty one is treated as missing.
The preflight compares them with the labels Docker reports on the running containers and
exits non-zero on any disagreement.

| Variable | Compared against | Live beta value |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | `com.docker.compose.project` | `zkoil3p3wo2mozpn833yu2ol` (the application uuid) |
| `CTR_BETA_APPLICATION_ID` | `coolify.applicationId` | `1` |
| `CTR_BETA_RESOURCE_NAME` | `coolify.resourceName` | `ctr-beta` |

`COMPOSE_PROJECT_NAME` **alone is not an identity**, and treating it as one was a real
defect: it is a plain string typed into a deployment field, so a value that happens to name
another existing compose project with a `db` service migrated that project's database and
exited 0. The other two come from labels Coolify stamps on every container it manages and
that no other application can carry — the unrelated `ctng-site` application on the same host
carries `coolify.applicationId=2` / `coolify.resourceName=ctng-site`. `coolify.applicationId`
is the `applications.id` row: it survives redeploy, rename and image change.

Coolify does not export these, which is why the command states them.
`generate_coolify_env_variables()` only emits `COOLIFY_RESOURCE_UUID` when the build pack is
not `dockercompose` or the compose parsing version is 1 or 2 (ctr-beta is `dockercompose` at
version 5). `SOURCE_COMMIT` is emitted only when
`application_settings.include_source_commit_in_build` is on, and it **must** be on — see
[Release SHA verification](#release-sha-verification) for why the checkout cannot supply it.

### Database target verification

Before anything is built, the preflight resolves the database by **all three** identity labels
plus `com.docker.compose.service=db`, and requires **exactly one** match. Zero matches fail;
two or more fail. It never takes the first candidate.

It then requires `ct-api`, `ct-socket` and `nginx` to carry the same application identity, so a
stray database from another stack cannot satisfy the check on its own; picks the network the
verified `db` and the verified `ct-api` **both** sit on, failing if that is not exactly one
network; and checks the schema name the database was created with (`MYSQL_DATABASE`) against
the `DB_DATABASE` this release would migrate. The schema name is a consistency check on top of
an identity already proven — any CTR stack would answer `cybertown`, so it is never the proof.

### Release SHA verification

**There is no git repository in the build directory.** `deploy_docker_compose_buildpack()`
calls `cleanup_git()` at `ApplicationDeploymentJob.php:663`, which runs
`rm -fr {basedir}/.git`, and only then reaches the Custom Build Command at line 715. An
earlier version of the preflight opened with `git rev-parse HEAD` and could never have
passed; deployment `cf2a0130-8306-4920-9751-43ec9efae08d` on 2026-09-12 proved it live,
failing on that line while the old release kept serving.

The release sha now comes from `SOURCE_COMMIT` in `/artifacts/build-time.env`, which
`save_buildtime_environment_variables()` writes at line 713 — the step immediately before the
preflight. **This requires `Include SOURCE_COMMIT in build` to be ON for the ctr-beta
application**; with it off the value is absent and the preflight fails closed with a message
saying so. The shell environment is not a second source: the custom-build branch does not
prepend `$coolify_variables`, and the helper container is only restarted with the resolved
commit when `use_build_secrets` is on. `SOURCE_COMMIT` from the environment is honoured as an
override so the script can be run by hand outside Coolify.

The value must be forty lowercase hex characters. Coolify writes the literal `HEAD` or
`unknown` before it resolves the branch, and both are refused rather than tagged onto an image
as a release.

This is weaker than what it replaces, and deliberately so rather than by oversight. The sha
used to be computed from the working tree with `SOURCE_COMMIT` checked against it; now it is
Coolify's word. It is used for log lines and for tagging the migration image — no gate that
decides whether a database may be migrated depends on it.

Repository identity is proven by the presence of CTR's first migration,
`api/db/migrations/20220521061146_init_schema.ts`, instead of the root commit
`30fd2c250cd1f7154c2c3df03ec23fb47a19e1f4`, which needed git. The filename is effectively
immutable: knex records applied migrations by name, so every existing CTR database holds that
exact string and renaming it would re-run `init_schema` against a populated database. It is a
path rather than a hash, so a hostile repository could create it — it is a cheap early filter,
not the last line of defence. A checkout that passes it still has to match the application
labels, resolve to exactly one database container under that identity, share exactly one
network with it, and agree with `MYSQL_DATABASE` before any migration runs.

`docker/beta/release-preflight.test.sh` covers both gates with no Docker and no database.

### Wrong-project failure behavior

Every identity check runs in phase 0, before the build and long before the migration. A
failure prints what was expected against what Docker reported and exits non-zero, so Coolify
throws `DeploymentException` at line 715 and never reaches line 782: **no image is built, no
migration runs, no database is touched, and the old release keeps serving.**

## Migration owner

One script owns migrations: **`docker/beta/migrate-db.sh`**, run from the `ct-migrate`
service's image (`tooling` target of `docker/beta/api.Dockerfile`).

`ct-migrate` sits behind the `migrate` profile, so an ordinary `up` never starts it. Only the
preflight asks for it. The API and socket images are built from the `runtime` and `socket`
targets, which carry neither ts-node nor `db/migrations`, so they cannot become a second
migration owner even by accident.

The preflight runs the migration by **image ID**, captured the instant after the build. A
fixed tag like `ctr-beta-tooling` is exactly how a preflight ends up running last release's
migration files; an ID cannot be stale. The ID and the release SHA are both printed into the
deployment log, and the image is also tagged `ctr-beta-tooling:<release-sha>`.

## Migration command

`docker/beta/migrate-db.sh`, in order:

1. `node db-helpers.js wait` — retries the MySQL connection until it succeeds, gives up after
   120 s with the driver's own error. No fixed sleep anywhere in the path.
2. `node db-helpers.js create` — `CREATE DATABASE IF NOT EXISTS`. A no-op against the existing
   beta database; it only saves a manual step on a fresh disposable stack.
3. `knex migrate:latest --knexfile src/knexfile.ts`
4. `knex migrate:list` — prints the resulting schema state into the deployment log.

## Expand first: preflight migrations must be backward compatible

The schema is updated **while the previous release is still serving it**. For the length of
the preflight, and for however long a failed rollout takes to sort out, old code is running
against the new schema. A migration that runs before application replacement must therefore
be compatible with the release that is already deployed.

Safe in a single release:

* add a table
* add a nullable column
* add an index, where the lock is acceptable
* insert new, independent rows

Needs to be split across two releases (expand now, contract later):

* drop a column the current code reads
* rename a required column
* drop a table the current code uses
* change the meaning of an existing field incompatibly

Expand-first is what makes the previous release re-deployable after a failure, which is the
recovery path below. This is an operational rule, not an automated check — no classifier
inspects your migration.

## No seeds. Ever.

The release path runs migrations **only**. It never runs `db:seed`, `db:init`, `bootstrap-db`,
a reset, or a drop. The complete set of commands it can reach:

```
release-preflight.sh : docker compose --profile migrate build --pull
                       docker image tag
                       docker run --rm ... <image-id> migrate-db
migrate-db.sh        : node db-helpers.js wait
                       node db-helpers.js create
                       knex migrate:latest
                       knex migrate:list
```

`migrate-db` is named explicitly on the `docker run` line. The tooling image's default `CMD`
is `bootstrap-db`, so naming the command is what keeps the seeding path unreachable from a
release.

Seed files insert rows, and several are written for an empty database; re-running them
against a live one duplicates or overwrites citizen-visible data. A release that needs new
rows puts them in a migration, which knex records and never applies twice.

`docker/beta/bootstrap-db.sh` is the first-run tool and is a different thing entirely: it
seeds, and it refuses a database that already has tables. It stays behind the `bootstrap`
profile and is never part of a deployment.

## Failure behavior

`release-preflight.sh` and `migrate-db.sh` both run under `set -euo pipefail`. No `|| true`,
no `; exit 0`, no background execution.

**Preflight fails** (bad migration, build failure, database never returns):

* the build command exits non-zero;
* Coolify throws `DeploymentException` and marks the deployment **failed**;
* line 782 is never reached, so nginx, ct-api and ct-socket are **not stopped**;
* the old release keeps serving, on the same container IDs, with no gap.

**Database temporarily down**: the migrator waits (up to 120 s) and proceeds when MySQL
returns. The rollout waits with it. A database that never returns fails the release, and
again the old containers are not touched.

**No db container at all** is fatal and deliberate. The preflight will not create one: Coolify
rewrites this compose file onto an external network, so a database started from the file as
written lands on `<project>_default`, and the rollout would then create a *second*, empty
database on the real network. Bringing up a first database is the bootstrap's job.

## Do not automatically roll a migration back

If the **application rollout** fails after the migration has already succeeded, the database
stays forward. Nothing runs `down()` automatically, and nothing should: a `down()` that drops
a column or a table destroys data, and it would run at exactly the moment the system is
already in a bad state.

The supported response, in order:

1. **Stop.** Do not redeploy repeatedly.
2. **Preserve evidence** — deployment log, container state, `knex migrate:list`.
3. **Restore service** with the last release that works against the current schema. Because
   preflight migrations are expand-first, that is normally the *previous* release, redeployed
   unchanged.
4. Fix forward in a new release, or restore the verified backup, under an approved recovery
   plan.

Note what Coolify's own rolling behaviour costs here: the old containers were already stopped
at line 782 before the rollout failed at 806, so this case *is* an outage. It is not caused by
the preflight — the preflight had already passed — and it is the same exposure any compose
release on this platform has.

## Idempotence and locking

`migrate:latest` applies only the migrations absent from the `migrations` table, so a release
with nothing pending logs `Already up to date`, exits 0, and changes no rows. Redeploys are
safe.

Knex takes a row lock in `migrations_lock` for the duration of a run. The stack does not rely
on this — it has a single migration owner — but the protection is there.

## The backup rule still applies

A migration-bearing beta release still requires, in order:

1. full database backup;
2. backup verification;
3. restore rehearsal, when the release risk calls for it;
4. deployment;
5. post-deploy checks.

The preflight removes "new code, old schema" and it removes "a bad migration takes the site
down". It does not make a bad migration recoverable. Only the backup does that.

## Local verification

Rehearses the real release path against a disposable, populated database. Nothing here
touches beta.

```shell
# 1. a disposable stack on a Coolify-shaped external network
cat > /tmp/ctrpf/env <<'EOF'
DB_USER=ctr
DB_PASS=ctrpass
DB_DATABASE=cybertown
MYSQL_ROOT_PASSWORD=rootpass
JWT_SECRET=rehearsal-only
EOF
# The overlay reproduces what Coolify does to the deployed stack: an external network named
# after the project, and the identity labels the preflight verifies. Without the labels the
# preflight fails closed, which is correct -- an unlabelled stack is not the beta application.
cat > /tmp/ctrpf/coolify-net.yml <<'EOF'
networks:
  default:
    name: ctrpf
    external: true
services:
  db:      { labels: { coolify.applicationId: "901", coolify.resourceName: ctr-beta-rehearsal } }
  ct-api:  { labels: { coolify.applicationId: "901", coolify.resourceName: ctr-beta-rehearsal } }
  ct-socket: { labels: { coolify.applicationId: "901", coolify.resourceName: ctr-beta-rehearsal } }
  nginx:   { labels: { coolify.applicationId: "901", coolify.resourceName: ctr-beta-rehearsal } }
EOF
docker network create ctrpf

DC="docker compose -f docker-compose.beta.yml -f /tmp/ctrpf/coolify-net.yml \
    --env-file /tmp/ctrpf/env --project-name ctrpf"

$DC --profile bootstrap build
$DC up -d db
$DC --profile bootstrap run --rm ct-bootstrap    # populate a FRESH disposable database
$DC up -d                                        # release A, healthy

# 2. record what must survive a failed release
docker ps --filter label=com.docker.compose.project=ctrpf \
  --format '{{.Label "com.docker.compose.service"}} {{.ID}}'

# 3. add a deliberately failing migration to api/db/migrations, then run phase 1 ALONE
COMPOSE_PROJECT_NAME=ctrpf CTR_BETA_APPLICATION_ID=901 CTR_BETA_RESOURCE_NAME=ctr-beta-rehearsal \
  PREFLIGHT_ENV_FILE=/tmp/ctrpf/env \
  bash ./docker/beta/release-preflight.sh ; echo "preflight exit: $?"

# 3b. the wrong-project gate: name any OTHER existing project and it must refuse, not migrate
COMPOSE_PROJECT_NAME=<some-other-project> CTR_BETA_APPLICATION_ID=901 \
  CTR_BETA_RESOURCE_NAME=ctr-beta-rehearsal PREFLIGHT_ENV_FILE=/tmp/ctrpf/env \
  bash ./docker/beta/release-preflight.sh ; echo "must be non-zero: $?"

# 4. the container IDs from step 2 must be unchanged, and the site must still answer
docker run --rm --network ctrpf curlimages/curl:8.5.0 -sI http://nginx/ | head -1

$DC down -v                                      # disposable: -v removes the fixture volume
rm -f api/db/migrations/<the throwaway migration>
docker network rm ctrpf
```

Delete the throwaway migration afterwards. Migration history is permanent — never commit a
rehearsal fixture.
