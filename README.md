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

* [node/npm][node] (version 14.18.1)
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

**The production containers still run Node 14.21.3.** That split is temporary and expected:
this step moves the developer and build baseline only, so that Node 24 is proven before the
runtime images are cut over. The legacy `master` deploy host also still requires Node 14.
The npm 6 inside `node:14` does not enforce a package's own `engines` field, so `npm ci`
there is silent and all four beta image targets still build.

##### webpack 4 and OpenSSL 3

webpack 4 hashes module ids with MD4, and the OpenSSL 3 inside Node 17+ removed it, so a
plain `vue-cli-service` compile on Node 24 fails with `ERR_OSSL_EVP_UNSUPPORTED`. The
`serve`, `build` and `dev` scripts in `spa/package.json` therefore run through
`spa/scripts/vue-cli-service.js`, which adds `--openssl-legacy-provider` to the child
process only, and only when the running Node is 17 or newer. Node 14 gets nothing, because
it rejects the flag outright.

Do not set `NODE_OPTIONS=--openssl-legacy-provider` anywhere else - not in a shell profile,
a Dockerfile or a compose file. It is a build-time bridge for webpack 4 alone. The Vue CLI 5
/ webpack 5 upgrade removes both the bridge and this wrapper.

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
