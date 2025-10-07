import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default [
  { ignores: ["dist/**", "build/**", "coverage/**", "node_modules/**"] },

  {
    files: ["**/*.{js,cjs,ts,cts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",         
      globals: { ...globals.node },   
    },
    rules: {
      ...js.configs.recommended.rules, 
      "no-unused-vars": "off", 
    },
  },

  ...tseslint.config({
    files: ["**/*.{ts,cts}"],
    extends: [
      ...tseslint.configs.recommended,          
    ],
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "warn",
    },
  }),

  {
    files: ["**/*.{test,spec}.{ts,js}"],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
    plugins: { jest: await import("eslint-plugin-jest") },
    rules: {
      "jest/no-disabled-tests": "warn",
      "jest/expect-expect": "warn",
    },
  },

  {
    files: ["**/*.{mjs,mts}"],
    languageOptions: {
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
];
