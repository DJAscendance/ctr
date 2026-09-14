/**
 * Runs `vue-cli-service` with the OpenSSL compatibility webpack 4 needs on a modern Node.
 *
 * webpack 4 hashes module and chunk ids with MD4. OpenSSL 3, which ships inside Node 17 and
 * later, dropped MD4 from its default provider, so every webpack 4 compile on Node 24 dies
 * with `ERR_OSSL_EVP_UNSUPPORTED` before it emits anything. `--openssl-legacy-provider`
 * re-enables the old algorithms and is the documented bridge for exactly this case.
 *
 * The flag cannot simply be written into the npm script. It does not exist before Node 17,
 * and a Node 14 runtime refuses to start when it is set. The beta images are on Node 24 now,
 * but the legacy `master` deploy host still builds on Node 14, so both runtimes still have to
 * work. The decision is therefore made here, at launch, from the version of Node actually
 * executing this file. Nothing is exported to a shell, a profile or a container environment:
 * the variable is built for the child process only.
 *
 * This file is a bridge, not architecture. Vue CLI 5 / webpack 5 hashes with an algorithm
 * OpenSSL 3 still provides, and this wrapper goes away with that upgrade.
 */
const { spawn } = require("child_process");
const path = require("path");

const LEGACY_PROVIDER_FLAG = "--openssl-legacy-provider";
const FIRST_OPENSSL3_MAJOR = 17;

const nodeMajor = Number(process.versions.node.split(".")[0]);
const env = Object.assign({}, process.env);

if (nodeMajor >= FIRST_OPENSSL3_MAJOR && !(env.NODE_OPTIONS || "").includes(LEGACY_PROVIDER_FLAG)) {
  env.NODE_OPTIONS = env.NODE_OPTIONS ?
    `${env.NODE_OPTIONS} ${LEGACY_PROVIDER_FLAG}` :
    LEGACY_PROVIDER_FLAG;
}

const cli = path.join(__dirname, "..", "node_modules", "@vue", "cli-service", "bin",
  "vue-cli-service.js");

const child = spawn(process.execPath, [cli].concat(process.argv.slice(2)), {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code === null ? 1 : code);
});

child.on("error", (error) => {
  console.error(`Failed to start vue-cli-service: ${error.message}`);
  process.exit(1);
});
