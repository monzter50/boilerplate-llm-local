import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["**/dist/", "**/node_modules/", "coverage/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The SDK exposes reasoning fields that are missing from its own types,
      // so a few deliberate casts are unavoidable in llm.ts.
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The SDK may only use the contracts' types: a value import would ship
    // zod to every browser that uses the SDK.
    files: ["sdk/src/**/*.ts"],
    ignores: ["sdk/src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@ia-local/contracts",
              allowTypeImports: true,
              message:
                "Use `import type`: the SDK must not depend on zod at runtime.",
            },
          ],
        },
      ],
    },
  },
  {
    // git-assist runs in other repositories, so it may not reach into this
    // one: no imports from outside its own package (tests may use test/utils).
    files: ["packages/git-assist/src/**/*.ts"],
    ignores: ["packages/git-assist/src/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../../*", "../../../*"],
              message:
                "git-assist must stay standalone: import nothing from the rest of this repo.",
            },
          ],
        },
      ],
    },
  },
  {
    ...reactHooks.configs.flat["recommended-latest"],
    files: ["web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  // Formatting is Prettier's job; this turns off every rule that fights it.
  prettier,
);
