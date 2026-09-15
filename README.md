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

The SPA builds with `@vue/cli-service` 5.0.9 on webpack 5. Vue Router stays on 3.5.2. Vue
itself is now 3.5.42, run through the official migration build - see below.

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

`@vue/cli-plugin-eslint` is **not** installed. Its 5.x line requires ESLint >= 7.5.0, and this
SPA is pinned to ESLint 6.8 with `eslint-plugin-vue` 6; moving the linter is a separate lane.
`npm run lint` therefore calls `eslint` directly with the same `eslintConfig` from
`spa/package.json`, over the same directories `vue-cli-service lint` used. It still passes
`--fix`, so it rewrites files - use `npx eslint --quiet <path>` to check one file without that.

`@types/node` is pinned to `^16.11.2` as a direct devDependency. It used to arrive
transitively; the Vue CLI 5 tree floats it to a release whose `.d.ts` files use syntax old
TypeScript cannot parse, which fails the build. TypeScript has since moved to 4.3.5, which is
not obviously far enough to lift the pin, and nothing needs a newer Node type.

##### Vue 3 migration build (@vue/compat)

Vue is 3.5.42, but the application is still written as a Vue 2 application. `vue` resolves to
`@vue/compat` and the SFC compiler runs in compatibility **MODE 2**, which means "behave like
Vue 2, and warn about everything you had to bend to do it". Options API, `Vue.extend`,
`Vue.prototype`, `new Vue(...).$mount()`, template filters and `$on`/`$emit` event buses all
still work. `vue`, `@vue/compat` and `@vue/compiler-sfc` must stay on the **same exact
version** - the migration build refuses a mismatched runtime.

Two hooks in `spa/vue.config.js` set this up, and the file explains both:

- `resolve.alias` sends `vue$` to `@vue/compat/dist/vue.runtime.esm-bundler.js`,
- the vue-loader rule gets `compilerOptions.compatConfig = { MODE: 2 }`.

**Do not add a global migration-warning suppression.** A development build reports around 40
deprecation warnings across 15 ids. They are not failures - they are the work list for the
next phase, which turns MODE 2 off one feature at a time.

TypeScript cannot follow a webpack alias, so both tsconfigs map `vue` through `paths` to
`spa/src/types/vue-compat`. Vue's migration guide says to point that at `@vue/compat`
directly; that does not work as published, because `@vue/compat@3.5.42` declares
`"types": "./dist/vue.d.ts"` and ships only `dist/vue-compat.d.ts`. The local file is that
missing entry point and nothing more.

Three dependency decisions a future reader will otherwise undo:

- **`vue-gtag` is 2.1.2 and is NOT given the router.** vue-gtag 2 tracks routes through Vue
  Router 4 only (`router.isReady()`, `router.currentRoute.value`); handing it Router 3 throws
  during bootstrap and the app never mounts. `spa/src/main.ts` runs the same page tracking
  against Router 3's own `onReady`/`afterEach` instead. Do not "fix" this by passing `router`
  back in, and do not move to vue-gtag 3.x - it requires `vue-router@^4.5.0`.
- **`vue-template-compiler` is gone.** It is the Vue 2 SFC compiler, replaced by
  `@vue/compiler-sfc`. It is an optional peer of the Vue CLI packages, so nothing wants it
  back. Vue CLI 5 also switches itself from vue-loader 15 to vue-loader 17 once Vue is 3.x -
  do not add a direct `vue-loader` dependency to force that.
- **TypeScript is 4.3.5, not 4.1.** 4.1 cannot *parse* Vue 3's declaration files:
  `@vue/reactivity` uses `get value(): T` inside an interface, which is 4.3 syntax, so it
  fails with TS1131 before type checking and `skipLibCheck` cannot hide it. 4.3.5 is the
  lowest version that works and it keeps the existing @typescript-eslint 4.x / ESLint 6.8
  stack. A clean run with `skipLibCheck: false` would need 5.4; both tsconfigs set
  `skipLibCheck: true`.

`eslint-plugin-vue` is 7.x and the config extends `plugin:vue/vue3-essential`, not
`plugin:vue/essential`. Same rule tier, correct Vue major: the Vue 2 ruleset's
`vue/no-template-key` told you to do the opposite of what the Vue 3 compiler requires. The
Vue 3 ruleset flags around 18 genuine leftovers (`beforeDestroy`/`destroyed` hook names,
template filters). Those are real debt for the cleanup phase - do not switch the ruleset back
to hide them. ESLint itself stays on 6.8; eslint-plugin-vue 7 still accepts it.

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
