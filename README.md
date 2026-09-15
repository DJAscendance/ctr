# Cybertown Revival

This project is an attempt to resurrect and preserve Cybertown, a VRML based community from the 
mid-90s/early-00s. This repository contains the entire codebase for the new platform, built by the community.


## How to Contribute

### As a Developer

We always welcome others to help out with VRML and the Single Page Application (SPA) and API. Take a look 
at our issue, fork this repository and start contributing. When you are ready, create a pull request, and we 
will review your changes to be merged into the official master branch.

### As a User

Submitting bugs, feedback and commenting on issues is the best way for non-developers to help with the 
project.

## Dev Stack

* Node.js
* Vue.js
* Tailwind.css
* MySQL
* Nginx
* socket.io
* docker
* VRML

## Development Environment Setup Instructions

We utilise docker to manage the entire development environment and to make it easy to set up and run.

### Requirements

You will need to have the following already installed on your machine and a basic understanding in order to 
run the development environment:

* [node/npm][node] (version 24.21.0)
* [docker][docker-ce]

You may also wish to install Docker for Desktop if you wish. For beginners, there are plenty of tutorials 
and videos online on installation and the basics of node, npm and docker.

#### Node runtime

The development and build baseline is **Node 24.21.0**. It is declared in `.tool-versions`
(asdf), `.nvmrc` (nvm) and the `engines` field of `api/package.json` and `spa/package.json`.
Both tools search parent directories, so the files at the repository root cover `api/` as
well; `spa/` carries its own `.tool-versions` because it is also built on its own.

`engines` is written as `>=24.21.0 <25`. It accepts the 24.x line and refuses 14.x, 22.x, 25
and 26. Node 26 is deliberately excluded: `jsonwebtoken` still reaches `SlowBuffer` through
`jws` -> `jwa` -> `buffer-equal-constant-time`, and Node 26 removed it.

**The beta Docker runtime is Node 24.21.0 as well.** Every Node stage in
`docker/beta/spa.Dockerfile` and `docker/beta/api.Dockerfile` -- SPA build, socket runtime,
API build, API runtime and the API tooling image -- and both Node services in
`docker-compose.yml` use one immutable digest pin:

```
node:24.21.0-bookworm@sha256:6dac556d980b7f0e5498d08f08cee0ca67798b4ad6c23964a9214920e67758d0
```

Pinning by digest, not by a floating `node:24` or `node:lts` tag, is what makes the runtime
version deterministic. Moving off `node:14` also moved the base OS from Debian 10 (buster,
glibc 2.28) to Debian 12 (bookworm, glibc 2.36); the native modules -- `bcrypt`, `sharp`,
`mysql2` -- are proven on that base, not assumed. The nginx image keeps its own separate
pin and is unchanged.

**The legacy `master` production host still requires Node 14.** It is a different host with
a different deploy path (`.github/workflows/main.yml`) and it was not part of this cutover.
Do not assume a change that lands on beta reaches it.

##### Vue CLI 5 and webpack 5

The SPA builds with `@vue/cli-service` 5.0.9 on webpack 5. Vue is 3.5.42 and Vue Router is
5.3.1, both native - see below.

webpack 4 used to hash module ids with MD4, which the OpenSSL 3 inside Node 17+ removed, so
every compile on Node 24 died with `ERR_OSSL_EVP_UNSUPPORTED`. `spa/scripts/vue-cli-service.js`
existed to add `--openssl-legacy-provider` to the build's child process. webpack 5 hashes with
an algorithm OpenSSL 3 still provides, so that wrapper is deleted and the `serve`, `build` and
`dev` scripts call `vue-cli-service` directly.

Do not set `NODE_OPTIONS=--openssl-legacy-provider` anywhere - not in a shell profile, a
Dockerfile, a compose file or an npm script. Nothing in this repository needs it now, and
setting it only re-enables a broken hash family.

Three things in `spa/vue.config.js` hold webpack 5 to the asset policy webpack 4 had, and the
file explains each one at the top:

- a css-loader `url.filter` that leaves root-relative `url(/assets/...)` alone, because nginx
  serves those files off disk and webpack must not pull them into the bundle,
- a 4096-byte inline limit on the `images`, `media` and `fonts` rules, which is what url-loader
  used under Vue CLI 4 (webpack 5 asset modules default to 8096),
- no eslint hook, because Vue CLI 5 moved linting from a webpack rule to a plugin.

`@vue/cli-plugin-eslint` is **not** installed; `npm run lint` calls `eslint` directly with
the `eslintConfig` from `spa/package.json`, over the same directories `vue-cli-service lint`
used. It still passes `--fix`, so it rewrites files - use `npx eslint --no-fix <path>` to check
one file without that. The lint stack is ESLint 8.57.1, `@typescript-eslint` 8.70,
`eslint-plugin-vue` 9.33 (`plugin:vue/vue3-essential`) and `@vue/eslint-config-typescript` 13,
the last eslintrc-format releases of each; ESLint 9's flat config is a separate lane.

`@types/node` is `24.10.1`, matching the Node the SPA builds and runs on.

##### Native Vue 3 and Vue Router 5

Vue is 3.5.42 and the application is a Vue 3 application: `@vue/compat` is not installed,
there is no `vue$` alias and no `compatConfig` in `spa/vue.config.js`, and `vue`,
`@vue/compiler-sfc` and `@vue/server-renderer` are on the same exact version. Vue Router is
5.3.1 on `createWebHashHistory()`, so every route still lives behind `/#/`.

How the app is wired, for anyone who last saw it as Vue 2:

- `spa/src/main.ts` does `createApp(App)`, installs the router and vue-gtag on it, and puts
  `$http`, `$store` and `$socket` on `app.config.globalProperties`. Their types are declared
  in `spa/src/types/vue-prototype.d.ts` by augmenting the `vue` module - the same module Vue
  Router augments for `$router`/`$route`. Augmenting `@vue/runtime-core` instead silently
  drops one of the two.
- Every component is `defineComponent({...})` (Options API, unchanged otherwise). The Mall
  staff lists share `mall-actions.mixin` through `mixins: [...]`.
- Shared state is `reactive(...)` (`appStore`, `mall-staff-state`).
- The two event buses (`ModalService`, the Outlands "team selected" signal) are instances of
  the small typed emitter in `spa/src/libs/event-bus.ts`. Vue 3 instances have no
  `$on`/`$off`.
- Lifecycle hooks are `beforeUnmount`/`unmounted`; the one date filter is called as a method;
  WorldBrowserPage's async place panels are `markRaw(defineAsyncComponent(...))`; the modal
  transition uses `.modal-enter-from`.
- Analytics: vue-gtag 3.7.1 is handed the router (`pageTracker`) and tracks routes itself. Its
  template keeps `page_title` as the document title (on a world route, the landed place's
  name), which is what the app has always sent.

Router 5 rules that differ from Router 3 and are relied on in `main.ts`:

- a guard returns its decision; the session guard keeps "first decision wins" through a small
  `decide()` helper, and the two late club-membership redirects are explicit `router.push`
  calls, which is what Router 3 turned a late `next(location)` into;
- `afterEach` also runs for a navigation that did NOT land, with a failure as its third
  argument, so the place-commit hook skips those;
- a record added under an existing name REPLACES the earlier one, so no two records may
  share a name (`/club/:id`'s page is "club-page", not a second "world-browser");
- non-path params are dropped, so the ban notice reads `reason`/`enddate` from the
  navigation's history state.

`spa/tests/router-link.test.ts` and `spa/tests/route-contract.test.ts` render the real
templates through the real route table in plain Node and fail if a `<router-link>` stops
producing an `<a href="#/...">` or a public URL stops reaching its route. Keep them.

TypeScript is 5.9.3: Router 5's declaration files use `export { type X }` and other 4.5+
syntax that 4.3 cannot parse. `useUnknownInCatchVariables: false` keeps TypeScript 4's
`catch (e)` typing rather than annotating thirty catch blocks; lifting it is a small
dedicated cleanup.

The QA gates under `qa/` reach the running app through `#app.__vue_app__` - the store via
`.config.globalProperties.$store`, and the WorldBrowserPage instance by walking the vnode tree
from `._container._vnode.component`. `app._instance` is dev-only and is `null` in a
production bundle; do not use it.

### Initial Setup

1. Clone this repository to your machine.
2. Rename `spa/.env.example` to `spa/.env` and `api/.env.example` to `api/.env`.
3. In the cloned directory, run `docker-compose up` from command line. This will install the docker environment, install node dependencies via npm and start the servers.
4. Navigate to the `spa/` directory and run `npm run dev` to compile the SPA.
5. In your browser, visit http://localhost:8001/ to confirm it's running.

To run the environment again in the future, simple repeat steps 2 onwards.

### Creating the database

To initialize a database within the mysql container, run the command below from
within the `api/` directory.

Running this will create a new database using settings configured in `api/knexfile.ts`:

```shell
npm run db:init
```

After the database is created, the schema and some necessary seed data are created automatically.

### Automatically Compiling the SPA

When making changes to the SPA, provided you have ran `npm run dev` from `spa/` all your changes will be 
automatically re-compiled.

## Coding Standards

* 2 space indentation
* 100-110 max line length
* wrapped lines can have +1 space indentation
* use single quotes for strings, excluding SQL queries. 
* use triple equals (`===`) for comparisons
* no trailing spaces
* always leave a trailing (`,`) comma in lists
* blank line at the end of files

[node]: https://nodejs.org/en/
[docker-ce]: https://github.com/docker/docker-ce
