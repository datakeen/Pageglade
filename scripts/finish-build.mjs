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
  DOMPurify: 'node_modules/dompurify/LICENSE',
  'css-tree': 'node_modules/css-tree/LICENSE',
  'mdn-data': 'node_modules/mdn-data/LICENSE',
  'source-map-js': 'node_modules/source-map-js/LICENSE',
  'Noto-Nastaliq-Urdu': 'node_modules/@fontsource/noto-nastaliq-urdu/LICENSE',
})) {
  await copyFile(new URL(file, root), new URL(name + '.txt', licenses))
}
await copyFile(new URL('NOTICE.md', root), new URL('NOTICE.md', target))

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
