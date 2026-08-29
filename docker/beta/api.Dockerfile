# CTR beta API image.
#
# Three things this must NOT do, all of which the development stack does and all of which
# were live defects on the beta stack before this file existed:
#
#   * install dependencies at container start. `npm install` on boot resolves floating
#     ranges afresh every time, which mutated spa/package-lock.json during QA, and makes
#     start-up depend on the npm registry being reachable. Dependencies are installed here,
#     from the lockfile, with `npm ci`.
#   * run TypeScript through ts-node. The beta runs the output of `npm run build:prod`.
#   * open a debugger port. `npm run dev` is `node --inspect=0.0.0.0:9229 ...`, which on a
#     public host is remote code execution by design.
#
# Node 14.21.3 and npm 6 are what the project builds against; `npm ci` accepts the
# lockfileVersion 1 files unchanged, so no lockfile regeneration is needed.
#
# Build context is the repository root:
#   docker build -f docker/beta/api.Dockerfile .

# ---------------------------------------------------------------- dependencies
FROM node:14 AS deps
WORKDIR /usr/src/app
COPY api/package.json api/package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------- build
FROM deps AS build
COPY api/tsconfig.json api/tsconfig.prod.json ./
COPY api/src ./src
RUN npm run build:prod

# --------------------------------------------------------------------- tooling
# Migrations and seeds are .ts files, so the bootstrap needs ts-node and the full
# dependency tree. It is a separate image target precisely so the long-running API does
# not carry a TypeScript runtime. Run it on demand, never as part of serving traffic.
FROM deps AS tooling
WORKDIR /usr/src/app
COPY api/tsconfig.json api/tsconfig.prod.json ./
COPY api/src ./src
COPY api/db ./db
COPY docker/beta/bootstrap-db.sh /usr/local/bin/bootstrap-db
COPY docker/beta/db-helpers.js ./db-helpers.js
RUN chmod +x /usr/local/bin/bootstrap-db
CMD ["bootstrap-db"]

# --------------------------------------------------------------------- runtime
FROM node:14 AS runtime
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY api/package.json api/package-lock.json ./
RUN npm ci --only=production && npm cache clean --force
COPY --from=build /usr/src/app/dist ./dist

# ASSETS_DIR points at the SPA's asset tree, which the API writes uploads into. The
# runtime subtrees are then mounted over by named volumes, so the tracked defaults have to
# be re-seeded from a copy that lives outside those mount points.
COPY spa/assets /usr/src/spa/assets
COPY spa/assets/object /opt/seed-assets/object
COPY spa/assets/avatars /opt/seed-assets/avatars
COPY docker/beta/seed-assets.sh /usr/local/bin/seed-assets
RUN chmod +x /usr/local/bin/seed-assets \
    && mkdir -p /usr/src/app/private-uploads /usr/src/spa/assets/homes-uploads

EXPOSE 3000
CMD ["sh", "-c", "TARGET_ROOT=/usr/src/spa/assets seed-assets object avatars \
    && exec node -r dotenv/config dist/api.js"]
