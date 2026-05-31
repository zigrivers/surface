// Flat config (ESLint 9). Stack: TypeScript + Prettier + jsx-a11y.
// jsx-a11y is intentionally present: it doubles as a static a11y *grounding* input
// for the React adapter (see docs/tech-stack.md §4), not only project self-linting.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import jsxA11y from "eslint-plugin-jsx-a11y";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", ".surface/**", "docs/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "no-console": ["error", { allow: ["error"] }],
      eqeqeq: ["error", "always"],
    },
  },
  // Applied by the react adapter to target sources as a static a11y grounding pass:
  { files: ["**/*.{jsx,tsx}"], plugins: { "jsx-a11y": jsxA11y }, rules: jsxA11y.configs.recommended.rules },
  prettier,
);
