import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

// Common Node.js 18+ globals (inline to avoid a separate 'globals' package dep)
const nodeGlobals = {
  process: "readonly",
  console: "readonly",
  Buffer: "readonly",
  global: "readonly",
  setTimeout: "readonly",
  clearTimeout: "readonly",
  setInterval: "readonly",
  clearInterval: "readonly",
  setImmediate: "readonly",
  clearImmediate: "readonly",
  fetch: "readonly",
  URL: "readonly",
  URLSearchParams: "readonly",
  TextEncoder: "readonly",
  TextDecoder: "readonly",
  __dirname: "readonly",
  __filename: "readonly",
  require: "readonly",
  module: "readonly",
  exports: "readonly",
};

export default tseslint.config(
  // Ignore generated/dependency directories
  {
    ignores: ["node_modules/", ".aws-sam/", "**/node_modules/"],
  },

  // Base JS recommended rules for all files
  js.configs.recommended,

  // TypeScript files (Lambda source)
  {
    files: ["**/*.mts", "**/*.ts"],
    extends: [...tseslint.configs.recommended],
    languageOptions: {
      globals: nodeGlobals,
      parserOptions: {
        // Type-aware linting disabled (each lambda has its own tsconfig).
        // Enable per-lambda if you add a root tsconfig.json later.
        project: false,
      },
    },
  },

  // Plain JS files (E2E tests, scripts)
  {
    files: ["**/*.mjs", "**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: nodeGlobals,
    },
  },

  // Disable ESLint formatting rules that conflict with Prettier (must be last)
  prettier,
);
