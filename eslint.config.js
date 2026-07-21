// Import ESLint's recommended JavaScript rules as the baseline safety net.
import js from '@eslint/js'
// Import browser global definitions so DOM names are not treated as undefined.
import globals from 'globals'
// Import React Hooks rules to catch stale dependencies and invalid hook calls.
import reactHooks from 'eslint-plugin-react-hooks'
// Import React Refresh rules used by Vite's hot-reload workflow.
import reactRefresh from 'eslint-plugin-react-refresh'
// Import flat-config helpers used by modern ESLint versions.
import { defineConfig, globalIgnores } from 'eslint/config'

// Export one flat ESLint config array for the whole app.
export default defineConfig([
  // Ignore production build output; it is generated and should not be linted.
  globalIgnores(['dist']),
  // Apply these rules to JavaScript and JSX source/config files.
  {
    // Match the current project language set; there is no TypeScript here.
    files: ['**/*.{js,jsx}'],
    // Compose general JS, React Hooks, and Vite React Refresh recommendations.
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    // Tell ESLint that source runs in browsers and may contain JSX syntax.
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    // Rest-sibling destructuring (`const { drop, ...rest } = obj`) is the
    // idiomatic way to omit a key before passing the remainder along; the
    // dropped binding is never meant to be read.
    rules: { 'no-unused-vars': ['error', { ignoreRestSiblings: true }] },
  },
])
