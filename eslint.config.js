import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import noRawTailwindColors from './eslint-rules/no-raw-tailwind-colors.js';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  // Design system enforcement
  {
    files: ['components/**/*.tsx', 'App.tsx'],
    plugins: {
      'design-system': {
        rules: {
          'no-raw-tailwind-colors': noRawTailwindColors,
        },
      },
    },
    rules: {
      'design-system/no-raw-tailwind-colors': 'error',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'server/**', 'scripts/**'],
  },
);
