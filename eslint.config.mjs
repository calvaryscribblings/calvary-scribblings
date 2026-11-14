import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import globals from "globals";

const eslintConfig = defineConfig([
  ...nextVitals,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),

  // R43.1 — no-undef, as a hard error.
  //
  // R33.2 rewrote the square_posts effect in app/square/page.js from one
  // whole-node onValue to three per-child listeners plus a settling get(), and
  // left its lazy `await import('firebase/database')` destructuring only
  // { ref, onValue }. The effect threw `onChildAdded is not defined` on every
  // load, signed in or out, and the Square hung on its spinner in production.
  //
  // eslint-config-next does not extend eslint:recommended, so no-undef was off
  // and the file linted identically broken and fixed. It is switched on here
  // because it names that exact failure — and because the repo was already at
  // zero when it was enabled, so this costs no cleanup and is not on the
  // lint-ratchet's tolerated backlog. A binding used but never bound in scope
  // is a page that does not load; it does not get to be a warning.
  //
  // No extra `globals` dependency is needed: eslint-config-next already
  // supplies the browser, node and service-worker globals.
  {
    rules: { "no-undef": "error" },
  },

  // SAFETY-2B.1 — the one CommonJS file in the linted tree.
  //
  // eslint-config-next hands its browser + node globals only to the extensions
  // it lists, and .cjs is not one of them, so this preload (run with
  // `node --require` by tests/vault/bootstrap.test.mjs) linted as five
  // no-undef errors: process, Buffer, __dirname and Response twice. It is
  // declared here by name, and only it: any other .cjs that arrives still meets
  // no-undef and has to be declared on its own.
  {
    files: ["tests/vault/bootstrap-fetch.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
  },
]);

export default eslintConfig;
