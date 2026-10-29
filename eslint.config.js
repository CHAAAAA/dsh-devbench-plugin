/**
 * ESLint flat config.
 *
 * Besides syntax rules, the per-layer blocks below encode the architectural
 * dependency rules documented in README.md (项目结构) and AGENTS.md (开发约束):
 *
 *   host: plugin → http/tools → services → domain → storage/integrations/platform
 *                              ↘ shared / messages / prompts (leaf utilities)
 *   client: entry/plugin → views → ui → core → shared protocol
 *
 * If an import needs an exception, move the code instead of widening the rule.
 */
import js from '@eslint/js'
import globals from 'globals'

const baseRules = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
  eqeqeq: ['error', 'always'],
  'no-undef': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-control-regex': 'off',
}

function restricted(message, patterns) {
  return {
    'no-restricted-imports': ['error', {
      patterns: patterns.map((group) => ({ group: [group], message })),
    }],
  }
}

export default [
  { ignores: ['node_modules/**', 'dist/**', 'coverage/**', '.dsh-reviews/**'] },
  js.configs.recommended,
  {
    files: ['index.js', 'src/host/**/*.js', 'src/shared/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: baseRules,
  },
  {
    files: ['src/client/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, __PLUGIN_ID__: 'readonly' },
    },
    rules: baseRules,
  },
  {
    files: ['test/**/*.js', 'test/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: baseRules,
  },
  {
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: baseRules,
  },

  // ---- shared: leaf module used by both halves -------------------------------
  {
    files: ['src/shared/**/*.js'],
    rules: restricted('src/shared 只能包含跨端协议常量，不能依赖 host/client/Node/React', [
      '../host/**', '../client/**', 'node:*', 'react',
    ]),
  },

  // ---- client: never import host implementation ------------------------------
  {
    files: ['src/client/**/*.js'],
    rules: restricted('client 只能共享 src/shared 协议常量，不能导入 host 实现', [
      '../host/**', '../../host/**', '../../../host/**', 'node:*',
    ]),
  },
  {
    files: ['src/client/core/**/*.js'],
    rules: restricted('client/core 不能依赖 ui 或 views（依赖方向：views → ui → core）', [
      '../ui/**', '../views/**',
    ]),
  },
  {
    files: ['src/client/ui/**/*.js'],
    rules: restricted('client/ui 不能依赖 views（依赖方向：views → ui）', ['../views/**']),
  },
  {
    files: ['src/client/i18n/**/*.js'],
    rules: restricted('client/i18n 只应包含字典，不能依赖 UI 实现', [
      '../core/**', '../ui/**', '../views/**',
    ]),
  },

  // ---- host layering ---------------------------------------------------------
  {
    files: ['src/host/shared/**/*.js'],
    rules: restricted('host/shared 只能依赖 errors/messages/constants，不能依赖上层业务模块', [
      '../domain/**', '../services/**', '../http/**', '../tools/**',
      '../storage/**', '../integrations/**', '../platform/**', '../prompts/**',
    ]),
  },
  {
    files: ['src/host/prompts/**/*.js'],
    rules: restricted('host/prompts 只能依赖 constants，不能依赖业务模块', [
      '../domain/**', '../services/**', '../http/**', '../tools/**',
      '../storage/**', '../integrations/**', '../platform/**',
      '../messages/**', '../shared/**',
    ]),
  },
  {
    files: ['src/host/messages/**/*.js'],
    rules: restricted('host/messages 是纯字典，不能依赖其它模块', [
      '../domain/**', '../services/**', '../http/**', '../tools/**',
      '../storage/**', '../integrations/**', '../platform/**', '../prompts/**', '../shared/**',
    ]),
  },
  {
    files: ['src/host/storage/**/*.js'],
    rules: restricted('host/storage 不能依赖 domain 及更上层（依赖方向：services → domain → storage）', [
      '../domain/**', '../services/**', '../http/**', '../tools/**',
      '../integrations/**', '../platform/**', '../prompts/**',
    ]),
  },
  {
    files: ['src/host/integrations/**/*.js'],
    rules: restricted('host/integrations 不能依赖 domain 及更上层', [
      '../domain/**', '../services/**', '../http/**', '../tools/**',
      '../platform/**',
    ]),
  },
  {
    files: ['src/host/platform/**/*.js'],
    rules: restricted('host/platform 是最底层 OS 适配，不能依赖业务模块', [
      '../domain/**', '../services/**', '../http/**', '../tools/**',
      '../storage/**', '../integrations/**', '../prompts/**', '../shared/**',
    ]),
  },
  {
    files: ['src/host/domain/**/*.js'],
    rules: restricted('host/domain 不能依赖 http/services/tools（依赖方向：services → domain）', [
      '../http/**', '../services/**', '../tools/**', '../plugin.js',
    ]),
  },
  {
    files: ['src/host/services/**/*.js'],
    rules: restricted('host/services 不能依赖 http/tools，也不能被 plugin 直接绕过', [
      '../http/**', '../tools/**', '../plugin.js',
    ]),
  },
  {
    files: ['src/host/tools/**/*.js'],
    rules: restricted('host/tools 不能依赖 http，工具层由 plugin 注册', ['../http/**', '../plugin.js']),
  },
  {
    files: ['src/host/http/**/*.js'],
    rules: restricted('host/http 只能依赖下层模块，不能依赖 tools/plugin', [
      '../tools/**', '../../tools/**', '../plugin.js', '../../plugin.js',
    ]),
  },
]
