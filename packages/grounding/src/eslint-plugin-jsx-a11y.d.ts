declare module "eslint-plugin-jsx-a11y" {
  import type { ESLint, Linter } from "eslint";

  const plugin: ESLint.Plugin & {
    readonly configs: {
      readonly recommended: {
        readonly rules: Linter.RulesRecord;
      };
    };
  };

  export default plugin;
}
