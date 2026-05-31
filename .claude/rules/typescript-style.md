---
description: TypeScript/ESM conventions for surface source (strict types, named exports, node: builtins)
globs: ["packages/**/*.ts", "packages/**/*.tsx"]
---

- **TypeScript strict** everywhere (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
  **No `any`** — use `unknown` + a zod parse at boundaries.
- **ESM only**; import node builtins with the `node:` protocol (`import { readFile } from "node:fs/promises"`).
- **No default exports** in library packages — named exports only. (CLI bin entry may default-export.)
- **No deep cross-package imports** — talk through published entry points (`@surface/<pkg>`), never
  `@surface/core/src/*`. `core` depends downward only; adapters/reporters are leaf packages.
- Naming: files `kebab-case.ts`; types/classes `PascalCase`; funcs/vars `camelCase`; consts `UPPER_SNAKE`;
  zod schemas `XxxSchema` (inferred type `Xxx`).
- Use `pino` for logs (never `console.log` in libraries); diagnostics → stderr.
- Source of truth: `docs/coding-standards.md`.
