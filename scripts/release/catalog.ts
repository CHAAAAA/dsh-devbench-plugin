/**
 * `npm run release:catalog` — generate a DSH plugin market index (format 1).
 *
 * The index is what users add as an "index source" in DSH's Discover page so
 * they can find and install this plugin without typing the package name.
 *
 * Flags:
 *   --local                 build the index from package.json only (pre-publish preview)
 *   --check                 validate the existing index file and exit
 *   --out <path>            output path (default dist/catalog/index.json)
 *   --catalog-name <name>   catalog package name shown in npm/GitHub Pages
 *   --title-en/--title-zh   catalog title overrides
 *   --description-en/--description-zh  catalog description overrides
 *   --author <name>         author shown in the market entry
 *   --homepage <url>        https homepage for the entry
 *   --repository <url>      public repository URL for the entry
 *   --icon-base <url>       base URL for icon.svg (default jsDelivr for npm)
 *
 * Hosting and submission steps live in the AGENTS.md release section.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import {
  CATALOG_DIR,
  NPM_NAME,
  SEMVER,
  compareSemver,
  loadPackage,
  parseArgs,
  readJson,
  run,
} from '../lib/util.js'

const { flags, values } = parseArgs()
const pkg = loadPackage()
const outRel = values.get('out') || path.join('dist', 'catalog', 'index.json')
const iconBase = values.get('icon-base')
const author = values.get('author') || (typeof pkg.author === 'string' ? pkg.author : pkg.author?.name) || ''
const homepage = values.get('homepage') || pkg.homepage || ''
const repositoryUrl = values.get('repository') ||
  (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) || ''

const zhMeta = readLocaleMeta('zh')
const enMeta = readLocaleMeta('en')
const titleEn = values.get('title-en') || enMeta.title || pkg.name
const titleZh = values.get('title-zh') || zhMeta.title || pkg.name
const descriptionEn = values.get('description-en') || enMeta.description || pkg.description || ''
const descriptionZh = values.get('description-zh') || zhMeta.description || pkg.description || ''

function readLocaleMeta(locale) {
  try {
    const value = readJson('locale/' + locale + '.json')
    return value && value.meta ? value.meta : {}
  } catch {
    return {}
  }
}

function registryVersions() {
  const result = run('npm', ['view', pkg.name, 'time', 'versions', '--json'])
  if (result.status !== 0) {
    throw new Error('cannot read npm metadata for ' + pkg.name + ': ' +
      String(result.stderr || result.stdout).trim().split('\n')[0])
  }
  let data
  try {
    data = JSON.parse(result.stdout)
  } catch (failure) {
    throw new Error('cannot parse npm metadata: ' + failure.message)
  }
  const versions = Array.isArray(data.versions) ? data.versions : (data.versions ? [data.versions] : [])
  return { versions, time: data.time || {} }
}

function collectVersions() {
  if (flags.has('local')) {
    return [{ version: pkg.version, publishTimestamp: Math.floor(Date.now() / 1000) }]
  }
  const { versions, time } = registryVersions()
  const valid = versions
    .filter((version) => SEMVER.test(version))
    .map((version) => {
      const published = Date.parse(time[version] || '')
      return {
        version,
        publishTimestamp: Number.isFinite(published) ? Math.floor(published / 1000) : null,
      }
    })
    .filter((entry) => entry.publishTimestamp !== null)
  valid.sort((left, right) => compareSemver(right.version, left.version))
  return valid
}

function validateMarketIndex(index) {
  const problems = []
  const require = (condition, message) => {
    if (!condition) problems.push(message)
  }
  const localized = (value, where) => {
    require(value && typeof value === 'object' && typeof value.en === 'string' && value.en.length > 0,
      where + ' must be a localized object with an English fallback')
  }
  require(index.format === 1, '$.format must be 1')
  localized(index.title, '$.title')
  localized(index.description, '$.description')
  const categories = index.metadata?.categories || {}
  const labels = index.metadata?.labels || {}
  require(Array.isArray(index.plugins) && index.plugins.length > 0, '$.plugins must not be empty')
  const names = new Set()
  for (const [position, plugin] of (index.plugins || []).entries()) {
    const at = '$.plugins[' + position + ']'
    require(NPM_NAME.test(plugin.name), at + '.name is not a valid npm name')
    require(names.has(plugin.name) === false, at + '.name is duplicated')
    names.add(plugin.name)
    if (plugin.title !== undefined) localized(plugin.title, at + '.title')
    if (plugin.description !== undefined) localized(plugin.description, at + '.description')
    if (plugin.homepage !== undefined) require(/^https?:\/\//.test(plugin.homepage), at + '.homepage must be http(s)')
    if (plugin.repository?.url !== undefined) {
      require(/^https?:\/\//.test(plugin.repository.url), at + '.repository.url must be http(s)')
      require(/\.tgz$/i.test(plugin.repository.url) === false, at + '.repository.url must not be a tarball')
    }
    if (plugin.icon !== undefined) {
      require(/^(https?:\/\/|data:)/.test(plugin.icon), at + '.icon must be an absolute URL or data: image')
      require(plugin.icon.startsWith('https:') || plugin.icon.startsWith('data:') ||
        plugin.icon.startsWith('http:'), at + '.icon must use http(s)')
    }
    require(Array.isArray(plugin.versions) && plugin.versions.length > 0, at + '.versions must not be empty')
    for (const version of plugin.versions || []) {
      require(SEMVER.test(version.version), at + '.versions[] must be exact SemVer: ' + version.version)
      require(Number.isInteger(version.publishTimestamp) && version.publishTimestamp >= 0 &&
        version.publishTimestamp < 100000000000, at + '.versions[].publishTimestamp must be Unix seconds')
      require(version.source && version.source.type === 'npm', at + '.versions[].source.type must be npm')
      if (version.source?.registry !== undefined) {
        require(/^https?:\/\//.test(version.source.registry), at + '.source.registry must be http(s)')
      }
      if (version.engines?.dsh !== undefined) {
        require(typeof version.engines.dsh === 'string' && /[0-9]/.test(version.engines.dsh) &&
          version.engines.dsh.startsWith('workspace:') === false,
        at + '.engines.dsh must be a SemVer range')
      }
    }
    const category = plugin.metadata?.category
    if (category !== undefined) {
      require(Object.hasOwn(categories, category), at + '.metadata.category is not declared in metadata.categories')
    }
    for (const label of plugin.metadata?.labels || []) {
      require(Object.hasOwn(labels, label), at + '.metadata.labels references an undeclared label')
    }
  }
  return problems
}

if (flags.has('check')) {
  const existing = readJson(outRel)
  const problems = validateMarketIndex(existing)
  if (problems.length > 0) {
    for (const problem of problems) console.error('release-catalog: ' + outRel + ': ' + problem)
    process.exit(1)
  }
  console.log('release-catalog: OK ' + outRel)
  process.exit(0)
}

let versions
try {
  versions = collectVersions()
} catch (failure) {
  console.error('release-catalog: ' + failure.message)
  console.error('  publish the package first, or use --local to preview the index')
  process.exit(1)
}
if (versions.length === 0) {
  console.error('release-catalog: no published versions found for ' + pkg.name)
  console.error('  publish the package first, or use --local to preview the index')
  process.exit(1)
}

const latestVersion = versions[0].version
const icon = iconBase
  ? iconBase.replace(/\/$/, '') + '/' + 'icon.svg'
  : 'https://cdn.jsdelivr.net/npm/' + pkg.name + '@' + latestVersion + '/icon.svg'

const plugin: Record<string, any> = {
  name: pkg.name,
  title: { en: titleEn, zh: titleZh },
  description: { en: descriptionEn, zh: descriptionZh },
  icon,
  author,
  metadata: {
    category: 'productivity',
    keywords: Array.isArray(pkg.keywords) ? pkg.keywords : [],
    labels: [],
  },
  versions: versions.map((entry) => ({
    version: entry.version,
    publishTimestamp: entry.publishTimestamp,
    source: { type: 'npm' },
    engines: { dsh: pkg.engines?.dsh || '' },
  })),
}
if (homepage) plugin.homepage = homepage
if (repositoryUrl) plugin.repository = { url: repositoryUrl }

const catalogName = values.get('catalog-name') || pkg.name + '-catalog'
const index = {
  format: 1,
  title: {
    en: titleEn + ' Plugin Index',
    zh: titleZh + '插件索引',
  },
  description: {
    en: 'Plugin index for ' + pkg.name + ' (' + catalogName + ').',
    zh: pkg.name + ' 插件索引（' + catalogName + '）。',
  },
  metadata: {
    categories: {
      productivity: { title: { en: 'Productivity', zh: '效率' } },
    },
    labels: {},
    sortKeys: {},
  },
  plugins: [plugin],
}

const problems = validateMarketIndex(index)
if (problems.length > 0) {
  for (const problem of problems) console.error('release-catalog: generated index is invalid: ' + problem)
  process.exit(1)
}

mkdirSync(CATALOG_DIR, { recursive: true })
const target = path.resolve(outRel)
mkdirSync(path.dirname(target), { recursive: true })
writeFileSync(target, JSON.stringify(index, null, 2) + '\n')

console.log('release-catalog: wrote ' + path.relative(process.cwd(), target) +
  ' (' + versions.length + ' version(s))')
console.log('  entry   : ' + pkg.name + ' v' + latestVersion)
console.log('  icon    : ' + icon)
if (flags.has('local')) {
  console.log('  note    : --local used; publishTimestamp is the generation time, not the npm publish time')
}
if (values.get('index-url')) {
  console.log('  index   : ' + values.get('index-url'))
}
console.log('  下一步：把 index.json 托管到 HTTPS（GitHub Pages / 独立 npm catalog 包），')
console.log('  然后在 DSH「插件 → 发现 → 索引源」中添加该 URL。详见 AGENTS.md 的发布章节。')
