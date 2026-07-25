import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

export default tseslint.config(
  {
    // Not linted:
    // - build output / caches / static assets
    // - scripts/** are Node build tooling (Blender/glTF gen), not app source
    // - VENDORED CONTRACT: src/types/GameState.ts + src/types/SocketEvents.ts are
    //   copied byte-verbatim from the server by scripts/sync-contract.mjs. The
    //   server is the source of truth, so we must NOT lint or modify them here.
    ignores: [
      'dist',
      'coverage',
      'public',
      'scripts/**',
      'node_modules',
      'src/types/GameState.ts',
      'src/types/SocketEvents.ts',
    ],
  },
  // Type-aware linting only applies to TS/TSX. Plain JS config files (this file,
  // etc.) are handled by js.configs.recommended below without a type program.
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.strictTypeChecked,
      ...tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      // eslint-plugin-react-hooks v5: the classic hooks rules only (no v7
      // React-Compiler experiments — this app does not use React Compiler).
      // Keep exhaustive-deps strict (error, not the default warn).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // react-three-fiber intrinsic elements (mesh, group, ambientLight, etc.)
      // legitimately use non-DOM JSX props (position, args, intensity, rotation,
      // castShadow, …). The DOM-oriented rule is wrong for R3F, so disable it.
      'react/no-unknown-property': 'off',
      // Keep the rule on for genuinely confusing cases, but allow the idiomatic
      // arrow shorthand `onClick={() => setX()}` (void-returning setters).
      '@typescript-eslint/no-confusing-void-expression': ['error', { ignoreArrowShorthand: true }],
    },
  },
  // Tests run under jsdom/vitest with Node + browser globals.
  {
    files: ['**/*.{test,spec}.{ts,tsx}'],
    languageOptions: { globals: { ...globals.node } },
  },
);
