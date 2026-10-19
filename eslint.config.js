// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const REMOTE_URL = '/^(https?:)?\\/\\/(?!localhost|127\\.0\\.0\\.1)/';
const remoteUrlMessage = 'Remote URLs are not allowed in app code (local-first, no CDNs).';

const restrictedSyntax = [
  { selector: `Literal[value=${REMOTE_URL}]`, message: remoteUrlMessage },
  { selector: `TemplateElement[value.raw=${REMOTE_URL}]`, message: remoteUrlMessage },
];

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/test-results/**',
      '**/playwright-report/**',
      'apps/desktop/src-tauri/target/**',
      'apps/desktop/src-tauri/gen/**',
      'apps/mobile/android/**',
      'apps/mobile/ios/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-restricted-syntax': ['error', ...restrictedSyntax],
    },
  },
  {
    // SPEC Sec 4 / QA ARCH-01: UI, core and shared packages never import platform SDKs directly.
    files: ['packages/**/*.{ts,tsx}', 'apps/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@capacitor/*', '@capacitor-community/*', '@tauri-apps/*'],
              message:
                'Platform SDKs are only used inside platform adapters (StorageAdapter, FileAdapter, ...), never from UI/core.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['**/*.config.{ts,js}', '**/*.test.{ts,tsx}', 'e2e/**/*.ts', 'apps/web/e2e/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  prettier,
);
