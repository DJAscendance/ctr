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

The development baseline is **Node 14.18.1**. It is declared in `.tool-versions` (asdf),
`.nvmrc` (nvm) and the `engines` field of `api/package.json` and `spa/package.json`. Both
tools search parent directories, so one file at the repository root covers `api/` and
`spa/` as well.

The `node:14` Docker image the compose stack runs is **Node 14.21.3**. That is why `engines`
is written as `>=14.18.1 <15` rather than a single exact version: it has to accept both the
local baseline and the container, while still refusing a newer major.

A migration to a modern Node LTS is planned but **not active**. Do not install Node 24 for
this repository yet; the build chain has not been moved.

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
