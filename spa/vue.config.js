/**
 * Vue CLI 5 / webpack 5 build configuration.
 *
 * Three of the hooks below exist only to hold webpack 5 to the asset policy webpack 4
 * already had. They are compatibility pins, not new behaviour:
 *
 * 1. `css.loaderOptions.css.url.filter` - css-loader 3 (webpack 4) left a root-relative
 *    `url(/assets/...)` alone. css-loader 4 and later resolve it against the build context,
 *    which pulled three nginx-served files out of `spa/assets` and into the bundle. Every
 *    `/assets/...` and `/externprotos/...` path is served off disk by nginx at runtime, so
 *    webpack must not touch it.
 *
 * 2. The 4096-byte `dataUrlCondition` on the asset rules - Vue CLI 4 used url-loader with a
 *    4096-byte inline limit. Vue CLI 5 switched to webpack 5 asset modules and does not set
 *    the limit, so webpack's own 8096-byte default applied and files between the two sizes
 *    silently turned into data URIs. 4096 is the limit this app was built with.
 *
 * 3. No eslint hook - Vue CLI 4 added an `eslint` webpack rule that this file deleted, to
 *    keep linting out of the build. Vue CLI 5 moved that to a plugin, and the SPA no longer
 *    installs @vue/cli-plugin-eslint at all (its 5.x needs ESLint 7+), so there is nothing
 *    left to delete. `npm run lint` calls eslint directly with the same rules.
 *
 * 4. The Vue 3 migration build - `vue` resolves to `@vue/compat`, and the SFC compiler runs
 *    in compatibility MODE 2. Vue CLI 5 sees vue@3 and already points `vue$` at
 *    `vue/dist/vue.runtime.esm-bundler.js` and switches to vue-loader 17; the two hooks
 *    below only redirect that same runtime-only entry to the compat build and hand the
 *    compiler its compat flag. MODE 2 means "behave like Vue 2 and warn", so this is a
 *    runtime swap, not an application rewrite. Migration warnings are deliberately NOT
 *    suppressed - they are the work list for the compatibility-cleanup phase.
 */
const fs = require('fs')
const packageJson = fs.readFileSync('./package.json')
const version = JSON.parse(packageJson).version || 0;
const webpack = require('webpack');

const INLINE_ASSET_LIMIT = 4096;
const ASSET_RULES = ['images', 'media', 'fonts'];

/**
 * Runtime-only, to match what Vue CLI picks for a non-`runtimeCompiler` project. Every
 * template in this app lives in an SFC and is compiled at build time, so the extra runtime
 * compiler would be dead weight.
 */
const COMPAT_RUNTIME = "@vue/compat/dist/vue.runtime.esm-bundler.js";

module.exports = {
  css: {
    loaderOptions: {
      css: {
        url: {
          filter: url => !url.startsWith('/'),
        },
      },
    },
  },
  chainWebpack: config => {
    ASSET_RULES.forEach(rule => {
      config.module.rule(rule).parser({
        dataUrlCondition: { maxSize: INLINE_ASSET_LIMIT },
      });
    });

    config.resolve.alias.set("vue$", COMPAT_RUNTIME);

    config.module
      .rule("vue")
      .use("vue-loader")
      .tap(options => ({
        ...options,
        compilerOptions: {
          ...(options && options.compilerOptions),
          compatConfig: { MODE: 2 },
        },
      }));
  },
  configureWebpack: {
    plugins: [
      new webpack.DefinePlugin({
        'process.env': {
          PACKAGE_VERSION: `"${version}"`,
        },
      }),
    ],
  },
}
