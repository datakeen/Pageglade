// SPDX-License-Identifier: AGPL-3.0-or-later
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const target = new URL('../dist/', import.meta.url)
const root = new URL('../', import.meta.url)
const licenses = new URL('licenses/', target)
await mkdir(licenses, { recursive: true })
for (const [name, file] of Object.entries({
  Pageglade: 'LICENSE',
  'foliate-js': 'node_modules/foliate-js/LICENSE',
  'zip.js': 'node_modules/@zip.js/zip.js/LICENSE',
  'zlib-streams': 'licenses/zlib-streams.txt',
  DOMPurify: 'node_modules/dompurify/LICENSE',
  'Babel-helpers': 'licenses/Babel-helpers.txt',
  'css-tree': 'node_modules/css-tree/LICENSE',
  'mdn-data': 'node_modules/mdn-data/LICENSE',
  'source-map-js': 'node_modules/source-map-js/LICENSE',
  'Noto-Nastaliq-Urdu': 'node_modules/@fontsource/noto-nastaliq-urdu/LICENSE',
  Vite: 'node_modules/vite/LICENSE.md',
  Rolldown: 'node_modules/rolldown/LICENSE',
})) {
  await copyFile(new URL(file, root), new URL(name + '.txt', licenses))
}
// Preserve additional copyrights and license conditions from source comments
// that the bundle's minifier can remove.
const sourceNotices = {
  'zip.js-source-notices': [
    'node_modules/@zip.js/zip.js/lib/core/constants.js',
    'node_modules/@zip.js/zip.js/lib/core/configuration.js',
    'node_modules/@zip.js/zip.js/lib/core/util/array.js',
  ],
  'source-map-js-source-notices': [
    'node_modules/source-map-js/lib/base64-vlq.js',
    'node_modules/source-map-js/lib/mapping-list.js',
  ],
  'DOMPurify-source-notices': ['node_modules/dompurify/dist/purify.es.mjs'],
}
for (const [name, paths] of Object.entries(sourceNotices)) {
  const notices = new Set()
  for (const path of paths) {
    const source = await readFile(new URL(path, root), 'utf8')
    const comments = (source.slice(0, 12_000).match(/\/\*[\s\S]*?\*\//g) ?? [])
      .filter(comment => /copyright|@license/i.test(comment))
    if (!comments.length) throw new Error('Review the third-party notice in ' + path)
    for (const comment of comments) notices.add(comment)
  }
  await writeFile(new URL(name + '.txt', licenses), [...notices].join('\n\n') + '\n')
}
await copyFile(new URL('NOTICE.md', root), new URL('NOTICE.md', target))
await copyFile(new URL('LICENSE', root), new URL('LICENSE', target))

const files = (await readdir(target, { recursive: true, withFileTypes: true }))
  .filter(entry => entry.isFile())
const { relative } = await import('node:path')
const { fileURLToPath } = await import('node:url')
const urls = files.map(entry => relative(fileURLToPath(target), entry.parentPath + '/' + entry.name).replaceAll('\\', '/')).sort()
const hash = createHash('sha256')
for (const path of urls) hash.update(path).update(await readFile(new URL(path, target)))
const cache = 'pageglade-' + hash.digest('hex').slice(0, 16)
const shell = JSON.stringify(urls)
await writeFile(new URL('sw.js', target), `// SPDX-License-Identifier: AGPL-3.0-or-later
const CACHE = ${JSON.stringify(cache)}
const urls = ${shell}.map(path => new URL(path, self.registration.scope).href)
const allow = new Set(urls)
const index = new URL('index.html', self.registration.scope).href
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(urls)))
})
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys())
      if (name.startsWith('pageglade-') && name !== CACHE) await caches.delete(name)
    await self.clients.claim()
  })())
})
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return
  const url = new URL(event.request.url)
  const navigation = event.request.mode === 'navigate' && url.href.startsWith(self.registration.scope)
    && (url.pathname === new URL(self.registration.scope).pathname || url.href === index)
  if (!navigation && !allow.has(url.href)) return
  event.respondWith((async () => {
    const cache = await caches.open(CACHE)
    return await cache.match(navigation ? index : url.href) ?? fetch(event.request)
  })())
})
`)
