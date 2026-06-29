import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Single flat config for the whole npm-workspaces monorepo (run via `npm run lint`).
// - Next.js + React rules apply only to the controller (the only web/JSX package).
// - TypeScript rules apply to every package.
export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/.next/**",
    "**/out/**",
    "**/build/**",
    "**/next-env.d.ts",
    // Prisma's generated client is not ours to lint.
    "packages/controller/src/generated/**",
  ]),

  // Next.js / React rules — controller only.
  ...nextVitals.map((c) => ({ ...c, files: ["packages/controller/**/*.{ts,tsx}"] })),

  // TypeScript rules — all packages.
  ...nextTs.map((c) => ({ ...c, files: ["**/*.{ts,tsx}"] })),

  // The Next.js plugin lives under packages/controller in this monorepo.
  { settings: { next: { rootDir: "packages/controller" } } },

  // Project rule tweaks.
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      // Allow intentionally-unused bindings prefixed with `_`
      // (e.g. `const { db: _omitDb, ...rest } = resource`).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      // React Compiler rules (new in react-hooks v6, pulled in by core-web-vitals):
      // they misfire on server components (`Date.now()` during render) and on the
      // idiomatic "mounted" effect pattern. Off until we adopt the compiler.
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
