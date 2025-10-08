import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default [
  { ignores: ["dist/**", "build/**", "coverage/**", "**/*.min.js"] },

  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module" },
    plugins: {},
    rules: { ...js.configs.recommended.rules },
  },

  ...tseslint.config({
    files: ["**/*.ts", "**/*.tsx"],
    ignores: ["dist/**", "build/**"],
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked, 
      prettier, 
    ],
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "warn",
      "no-console": "off",
    },
  }),

  {
    files: ["**/*.{ts,js}"],
    languageOptions: { globals: { node: true } },
    rules: {},
  },

  {
    files: ["**/*.{test,spec}.{ts,js}"],
    plugins: { jest: await import("eslint-plugin-jest") },
    rules: {
      "jest/expect-expect": "warn",
      "jest/no-disabled-tests": "warn",
    },
  },
];