/**
 * TypeScript side of the Vue 3 migration build.
 *
 * At runtime webpack resolves `vue` to `@vue/compat` (see `vue.config.js`), whose default
 * export is `CompatVue` - Vue 3's Vue-2-shaped global with `extend`, `use`, `filter`,
 * `observable`, `prototype` and `config` still on it. TypeScript does not follow a webpack
 * alias, so without this file every `import Vue from "vue"` is typed as plain Vue 3 and all
 * 163 `Vue.extend({...})` calls fail with TS2339.
 *
 * Vue's own migration guide says to point tsconfig `paths` at `@vue/compat`. That does not
 * work as published: `@vue/compat@3.5.42` declares `"types": "./dist/vue.d.ts"` but ships
 * only `dist/vue-compat.d.ts`, which re-exports the default and nothing else. This file is
 * that missing entry point and nothing more - the compat default, plus the Vue 3 API it
 * leaves out. `tsconfig.json` maps `vue` here.
 *
 * It is a type-only redirect. It declares no behaviour and hides no runtime incompatibility.
 */
import { CompatVue } from "@vue/runtime-dom";

export * from "@vue/runtime-dom";

/**
 * Vue 2 shipped `Vue` as a class, so one name carried both meanings: the value you call
 * `Vue.extend` on, and the instance type you write in `WeakMap<Vue, ...>`. Vue 3 splits
 * them. Merging an interface onto the const restores the single name the source already
 * uses. The interface is the compat build's own instance type - `ComponentPublicInstance`
 * plus the Vue 2 members compat keeps alive, `$on`/`$off`/`$emit` among them - so a Vue 2
 * era event bus still type-checks.
 */
declare const Vue: CompatVue;
// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface Vue extends InstanceType<CompatVue> {}

export default Vue;
