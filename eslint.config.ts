/**
 * ESLint flat config (TypeScript).
 *
 * Besides syntax rules, the per-layer blocks below encode the architectural
 * dependency rules documented in AGENTS.md (分层约束与开发约定):
 *
 *   host: plugin → http/tools → services → domain → storage/integrations/platform
 *                              ↘ shared / messages / prompts (leaf utilities)
 *   client: entry/plugin → views → ui → core → shared protocol
 *
 * If an import needs an exception, move the code instead of widening the rule.
 * ESLint loads this `.ts` config through `jiti` (see `npm run lint`).
 */
import js from '@eslint/js'
import { builtinModules } from 'node:module'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** Rules that apply to every TypeScript file. */
const baseRules = {
  eqeqeq: ['error', 'always'],
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-control-regex': 'off',
  // Type-aware checks belong to `npm run typecheck`; the TS parser already
  // reports undeclared identifiers, so the core rules would double-report.
  'no-undef': 'off',
  'no-unused-vars': 'off',
  '@typescript-eslint/no-unused-vars': ['error', {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrors: 'none',
  }],
}

function restricted(message: string, patterns: string[]) {
  return {
    'no-restricted-imports': ['error', {
      patterns: patterns.map((group) => ({ group: [group], message })),
    }],
  }
}

/** Parsing settings shared by every TypeScript block. */
const tsLanguage = {
  ecmaVersion: 'latest',
  sourceType: 'module',
  parser: tseslint.parser,
}

const nodeImports = ['node:*', ...builtinModules]
// Flat config replaces rule options, so every client layer repeats these bans.
const clientImports = ['../host/**', '../../host/**', '../../../host/**', ...nodeImports]

export default [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**', '.dsh-reviews/**'] },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: tsLanguage,
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: baseRules,
  },
  {
    files: ['eslint.config.ts', 'src/index.ts', 'src/host/**/*.ts', 'src/shared/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/client/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, __PLUGIN_ID__: 'readonly' } },
  },
  {
    files: ['test/**/*.ts'],
    languageOptions: { globals: globals.node },
  },

  // ---- shared: leaf module used by both halves -------------------------------
  {
    files: ['src/shared/**/*.ts'],
    rules: restricted('src/shared 只能包含跨端协议常量与纯类型，不能依赖 host/client/Node/React', [
      '../host/**', '../client/**', ...nodeImports, 'react',
    ]),
  },

  // ---- client: never import host implementation ------------------------------
  {
    files: ['src/client/**/*.ts'],
    rules: restricted('client 不能依赖 host 实现或 Node 模块', clientImports),
  },
  {
    files: ['src/client/core/**/*.ts'],
    rules: restricted('client/core 不能依赖 host/Node/ui/views（依赖方向：views → ui → core）', [
      ...clientImports, '../ui/**', '../views/**',
    ]),
  },
  {
    files: ['src/client/ui/**/*.ts'],
    rules: restricted('client/ui 不能依赖 host/Node/views（依赖方向：views → ui）', [
      ...clientImports, '../views/**',
    ]),
  },
  {
    files: ['src/client/i18n/**/*.ts'],
    rules: restricted('client/i18n 只应包含字典，不能依赖 host/Node/UI 实现', [
      ...clientImports, '../core/**', '../ui/**', '../views/**',
    ]),
  },

  // ---- host layering ---------------------------------------------------------
  {
    files: ['src/host/shared/**/*.ts'],
    rules: restricted('host/shared 只能依赖 errors/messages/constants，不能依赖上层业务模块', [
      '../domain/**', '../services/**', '../http/**', '../tools/**',
      '../storage/**', '../integrations/**', '../platform/**', '../prompts/**',
    ]),
  },
  {
    files: ['src/host/prompts/**/*.ts'],
    rules: restricted('host/prompts 只能依赖 constants，不能依赖业务模块', [
      '../domain/**', '../services/**', '../http/**', '../tools/**',
      '../storage/**', '../integrations/**', '../platform/**',
      '../messages/**', '../shared/**',
    ]),
  },
  {
    files: ['src/host/messages/**/*.ts'],
    rules: restricted('host/messages 是纯字典，不能依赖其它模块', [
      '../domain/**', '../services/**', '../http/**', '../tools/**',
      '../storage/**', '../integrations/**', '../platform/**', '../prompts/**', '../shared/**',
    ]),
  },
  {
    files: ['src/host/storage/**/*.ts'],
    rules: restricted('host/storage 不能依赖 domain 及更上层（依赖方向：services → domain → storage）', [
      '../domain/**', '../services/**', '../http/**', '../tools/**',
      '../integrations/**', '../platform/**', '../prompts/**',
    ]),
  },
  {
    files: ['src/host/integrations/**/*.ts'],
    rules: restricted('host/integrations 不能依赖 domain 及更上层', [
      '../domain/**', '../services/**', '../http/**', '../tools/**',
      '../platform/**',
    ]),
  },
  {
    files: ['src/host/platform/**/*.ts'],
    rules: restricted('host/platform 是最底层 OS 适配，不能依赖业务模块', [
      '../domain/**', '../services/**', '../http/**', '../tools/**',
      '../storage/**', '../integrations/**', '../prompts/**', '../shared/**',
    ]),
  },
  {
    files: ['src/host/domain/**/*.ts'],
    rules: restricted('host/domain 不能依赖 http/services/tools（依赖方向：services → domain）', [
      '../http/**', '../services/**', '../tools/**', '../plugin.js',
    ]),
  },
  {
    files: ['src/host/services/**/*.ts'],
    rules: restricted('host/services 不能依赖 http/tools，也不能被 plugin 直接绕过', [
      '../http/**', '../tools/**', '../plugin.js',
    ]),
  },
  {
    files: ['src/host/tools/**/*.ts'],
    rules: restricted('host/tools 不能依赖 http，工具层由 plugin 注册', ['../http/**', '../plugin.js']),
  },
  {
    files: ['src/host/http/**/*.ts'],
    rules: restricted('host/http 只能依赖下层模块，不能依赖 tools/plugin', [
      '../tools/**', '../../tools/**', '../plugin.js', '../../plugin.js',
    ]),
  },
]
