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
      // Vendored verbatim from QA (scripts/qa/README.md); not edited here.
      'scripts/qa/*.mjs',
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
      // Off (decisions.md E-49): screens export small hooks/helpers next to components; this only affects
      // dev HMR granularity, not correctness.
      'react-refresh/only-export-components': 'off',
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
    // QA M2 row 5/ENC: test-only hooks (raw stored bytes, data-key export) live in packages/storage/test.
    // Shipped storage code may never import them. Repeats the platform-SDK ban (rule options don't merge).
    files: ['packages/storage/src/**/*.ts'],
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
            {
              group: ['**/test/**', '**/harness/**', '**/qa-harness*', '**/fakes*'],
              message:
                'Test-only hooks and fakes must not be reachable from production storage code.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        ...restrictedSyntax,
        {
          selector: "MemberExpression[property.name='exportKey']",
          message: 'Keys are never exported in production code (test hook only).',
        },
      ],
    },
  },
  {
    // QA's contract suites are copied verbatim (qa/contract/storage); M2 row 2 requires them byte-identical.
    files: ['packages/storage/test/qa/**'],
    extends: [tseslint.configs.disableTypeChecked],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
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
