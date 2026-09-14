# CTR beta SPA + Socket.IO image, and the nginx image that fronts them.
#
# The socket server must run as a plain `node server.js` -- never under nodemon. With a
# watcher, writing any .js under spa/ restarts the chat server and drops every connected
# client at once; spa/nodemon.json narrowed the dev watcher to server.js, and the beta
# removes the watcher entirely. `npm start` is exactly that plain node process.
#
# Dependencies and the Vue build both happen here rather than at container start, for the
# reasons in api.Dockerfile. `--inspect=0.0.0.0:9230` from `npm run dev-server` is gone
# with the watcher.
#
# Build context is the repository root.

# ---------------------------------------------------------------- dependencies
FROM node:24.21.0-bookworm@sha256:6dac556d980b7f0e5498d08f08cee0ca67798b4ad6c23964a9214920e67758d0 AS deps
WORKDIR /usr/src/app
COPY spa/package.json spa/package-lock.json ./
RUN npm ci

# ------------------------------------------------------------------ spa build
FROM deps AS build
COPY spa/ ./
# No NODE_OPTIONS is set here, and none is set globally. `npm run build` goes through
# spa/scripts/vue-cli-service.js, which adds --openssl-legacy-provider only when the
# running Node is 17 or newer. On this Node 24 base the wrapper does add the flag, and
# that is the only thing keeping webpack 4's MD4 hashes working against OpenSSL 3. The
# bridge is temporary -- it goes away with the webpack 5 upgrade, not in this phase.
RUN npm run build

# --------------------------------------------------------------- socket server
FROM build AS socket
COPY spa/assets/object /opt/seed-assets/object
COPY spa/assets/avatars /opt/seed-assets/avatars
COPY docker/beta/seed-assets.sh /usr/local/bin/seed-assets
RUN chmod +x /usr/local/bin/seed-assets && mkdir -p /usr/src/app/assets/homes-uploads
EXPOSE 8000
CMD ["sh", "-c", "TARGET_ROOT=/usr/src/app/assets seed-assets object avatars \
    && exec npm start"]

# ----------------------------------------------------------------------- nginx
# nginx serves /assets and /externprotos off disk and proxies everything else, so it needs
# the same asset tree the other two services write into: the tracked files from the image
# plus the runtime volumes mounted over the two upload subtrees.
# Pinned by digest: nginx 1.31.2 on Alpine 3.23.5. Same image the tag pointed at.
FROM nginx:alpine@sha256:54f2a904c251d5a34adf545a72d32515a15e08418dae0266e23be2e18c66fefa AS web
COPY docker/nginx/vhost.conf /etc/nginx/conf.d/cybertown.conf
COPY spa/assets /var/www/cybertown/spa/assets
COPY spa/assets/object /opt/seed-assets/object
COPY spa/assets/avatars /opt/seed-assets/avatars
COPY docker/beta/seed-assets.sh /usr/local/bin/seed-assets
RUN chmod +x /usr/local/bin/seed-assets \
    && rm -f /etc/nginx/conf.d/default.conf \
    && mkdir -p /var/www/cybertown/spa/assets/homes-uploads
CMD ["sh", "-c", "TARGET_ROOT=/var/www/cybertown/spa/assets seed-assets object avatars \
    && exec nginx -g 'daemon off;'"]
