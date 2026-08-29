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
FROM node:14 AS deps
WORKDIR /usr/src/app
COPY spa/package.json spa/package-lock.json ./
RUN npm ci

# ------------------------------------------------------------------ spa build
FROM deps AS build
COPY spa/ ./
# No --openssl-legacy-provider here: that flag is Node 17+, and node:14 rejects it. The
# build works on node:14 precisely because this is the OpenSSL generation webpack expects.
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
FROM nginx:alpine AS web
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
