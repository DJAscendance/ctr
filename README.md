# Cybertown Revival

![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/DJAscendance/ctr?utm_source=oss&utm_medium=github&utm_campaign=DJAscendance%2Fctr&labelColor=171717&color=FF570A&link=https%3A%2F%2Fcoderabbit.ai&label=CodeRabbit+Reviews)
[![DeepScan grade](https://deepscan.io/api/teams/30342/projects/32191/branches/1050706/badge/grade.svg)](https://deepscan.io/dashboard#view=project&tid=30342&pid=32191&bid=1050706)
[![Build / Deploy](https://github.com/DJAscendance/ctr/actions/workflows/main.yml/badge.svg?branch=master)](https://github.com/DJAscendance/ctr/actions/workflows/main.yml)
<picture><source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/github/ci/DJAscendance/ctr.svg?variant=outline&amp;size=sm&amp;mode=dark&amp;font=jetbrains-mono"><img alt="CI" src="https://www.shieldcn.dev/github/ci/DJAscendance/ctr.svg?variant=outline&amp;size=sm&amp;mode=light&amp;font=jetbrains-mono"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/badge/Container-Docker-2496ED.svg?logo=docker&amp;variant=ghost&amp;size=sm&amp;mode=dark&amp;theme=neutral&amp;font=jetbrains-mono"><img alt="Container · Docker" src="https://www.shieldcn.dev/badge/Container-Docker-2496ED.svg?logo=docker&amp;variant=ghost&amp;size=sm&amp;mode=light&amp;theme=neutral&amp;font=jetbrains-mono"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/badge/Agent--friendly-AGENTS.md-D97757.svg?variant=ghost&amp;size=sm&amp;mode=dark&amp;theme=zinc&amp;font=jetbrains-mono"><img alt="Agent-friendly AGENTS.md" src="https://www.shieldcn.dev/badge/Agent--friendly-AGENTS.md-D97757.svg?variant=ghost&amp;size=sm&amp;mode=light&amp;theme=zinc&amp;font=jetbrains-mono"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/github/last-commit/DJAscendance/ctr.svg?variant=outline&amp;size=sm&amp;theme=green&amp;font=jetbrains-mono&amp;mode=dark"><img alt="Last commit" src="https://www.shieldcn.dev/github/last-commit/DJAscendance/ctr.svg?variant=outline&amp;size=sm&amp;theme=green&amp;font=jetbrains-mono&amp;mode=light"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/github/commits/DJAscendance/ctr.svg?variant=ghost&amp;size=sm&amp;mode=dark&amp;theme=rose&amp;font=jetbrains-mono"><img alt="Commits" src="https://www.shieldcn.dev/github/commits/DJAscendance/ctr.svg?variant=ghost&amp;size=sm&amp;mode=light&amp;theme=rose&amp;font=jetbrains-mono"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/github/branches/DJAscendance/ctr.svg?variant=ghost&amp;size=sm&amp;mode=dark&amp;theme=blue&amp;font=jetbrains-mono"><img alt="Branches" src="https://www.shieldcn.dev/github/branches/DJAscendance/ctr.svg?variant=ghost&amp;size=sm&amp;mode=light&amp;theme=blue&amp;font=jetbrains-mono"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/github/contributors/DJAscendance/ctr.svg?theme=emerald&amp;size=sm&amp;mode=dark&amp;font=jetbrains-mono&amp;variant=outline"><img alt="Contributors" src="https://www.shieldcn.dev/github/contributors/DJAscendance/ctr.svg?theme=emerald&amp;size=sm&amp;mode=light&amp;font=jetbrains-mono&amp;variant=outline"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/github/watchers/DJAscendance/ctr.svg?variant=ghost&amp;size=sm&amp;mode=dark&amp;theme=orange&amp;font=jetbrains-mono"><img alt="Watchers" src="https://www.shieldcn.dev/github/watchers/DJAscendance/ctr.svg?variant=ghost&amp;size=sm&amp;mode=light&amp;theme=orange&amp;font=jetbrains-mono"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/github/open-prs/DJAscendance/ctr.svg?variant=ghost&amp;size=sm&amp;mode=dark&amp;theme=purple&amp;font=jetbrains-mono"><img alt="Open PRs" src="https://www.shieldcn.dev/github/open-prs/DJAscendance/ctr.svg?variant=ghost&amp;size=sm&amp;mode=light&amp;theme=purple&amp;font=jetbrains-mono"></picture>
<picture><source media="(prefers-color-scheme: dark)" srcset="https://www.shieldcn.dev/github/merged-prs/DJAscendance/ctr.svg?variant=ghost&amp;size=sm&amp;mode=dark&amp;theme=cyan&amp;font=jetbrains-mono"><img alt="Merged PRs" src="https://www.shieldcn.dev/github/merged-prs/DJAscendance/ctr.svg?variant=ghost&amp;size=sm&amp;mode=light&amp;theme=cyan&amp;font=jetbrains-mono"></picture>

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
