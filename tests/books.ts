// SPDX-License-Identifier: AGPL-3.0-or-later
import { ZipWriter, Uint8ArrayWriter, TextReader, configure } from '@zip.js/zip.js'

configure({ useWebWorkers: false })

export async function fixture(options: { fixed?: boolean; rtl?: boolean; vertical?: boolean; epub2?: boolean; hostile?: boolean; drm?: boolean; traversal?: boolean; bomb?: boolean; pageList?: boolean; extraSections?: number } = {}) {
  const zip = new ZipWriter(new Uint8ArrayWriter())
  const opf = 'urn:oasis:names:tc:opendocument:xmlns:container'
  const lang = options.rtl ? 'ur' : options.vertical ? 'ja' : 'en'
  const xhtml = (body: string, extra = '') => `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" ${options.rtl ? 'dir="rtl"' : ''}><head><title>Test</title>${extra}</head><body>${body}</body></html>`
  const viewport = options.fixed ? '<meta name="viewport" content="width=600, height=800"/>' : ''
  const writing = options.vertical ? '<style>html{writing-mode:vertical-rl}</style>' : ''
  const bad = options.hostile ? `
    <script>window.parent.hijacked = true; fetch('https://tracker.invalid/script')</script>
    <img src="https://tracker.invalid/image" onerror="window.parent.hijacked = true" alt="remote image"/>
    <iframe src="https://tracker.invalid/frame"></iframe>
    <meta http-equiv="refresh" content="0;url=https://tracker.invalid/redirect"/>
    <style>@import "https://tracker.invalid/css"; p {background:url(https://tracker.invalid/style)}</style>
    <form action="https://tracker.invalid/form"><input name="book" value="secret"/></form>
    <a href="https://tracker.invalid/link" target="_blank">Outside link</a>
    <svg xmlns="http://www.w3.org/2000/svg"><image href="https://tracker.invalid/svg"/></svg>
  ` : ''
  const pageList = options.pageList
    ? '<nav epub:type="page-list"><ol><li><a href="one.xhtml">iv</a></li><li><a href="two.xhtml">7</a></li></ol></nav>' : ''
  const extras = Array.from({ length: options.extraSections ?? 0 }, (_, index) => 'extra' + index)
  const extraManifest = extras.map(id => '<item id="' + id + '" href="' + id + '.xhtml" media-type="application/xhtml+xml"/>').join('')
  const extraSpine = extras.map(id => '<itemref idref="' + id + '"/>').join('')
  const toc = options.epub2
    ? ['toc.ncx', `<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head/><docTitle><text>River</text></docTitle><navMap><navPoint id="one" playOrder="1"><navLabel><text>First bank</text></navLabel><content src="one.xhtml"/></navPoint><navPoint id="two" playOrder="2"><navLabel><text>Second bank</text></navLabel><content src="two.xhtml"/></navPoint></navMap></ncx>`]
    : ['nav.xhtml', xhtml('<nav epub:type="toc"><ol><li><a href="one.xhtml">First bank</a></li><li><a href="two.xhtml">Second bank</a></li></ol></nav>' + pageList)]
  const files = new Map([
    ['mimetype', 'application/epub+zip'],
    ['META-INF/container.xml', `<container version="1.0" xmlns="${opf}"><rootfiles><rootfile full-path="book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`],
    ['book.opf', `<package xmlns="http://www.idpf.org/2007/opf" version="${options.epub2 ? '2.0' : '3.0'}" unique-identifier="book"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book">urn:pageglade:river</dc:identifier><dc:title>River Notes</dc:title><dc:language>${lang}</dc:language>${options.fixed ? '<meta property="rendition:layout">pre-paginated</meta><meta property="rendition:spread">none</meta>' : ''}</metadata><manifest><item id="nav" href="${toc[0]}" media-type="${options.epub2 ? 'application/x-dtbncx+xml' : 'application/xhtml+xml'}"${options.epub2 ? '' : ' properties="nav"'}/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two.xhtml" media-type="application/xhtml+xml"/>${extraManifest}</manifest><spine${options.epub2 ? ' toc="nav"' : ''}${options.rtl ? ' page-progression-direction="rtl"' : ''}><itemref idref="one"/><itemref idref="two"/>${extraSpine}</spine></package>`],
    toc as [string, string],
    ['one.xhtml', xhtml(`<h1>First bank</h1><p>We watched the river at noon. It turned around the foot of the hill, carrying the sky with it. From the path, the water looked still. Down among the stones, it was already somewhere else.</p><p>I had brought a notebook, thinking I might draw the old ferry landing. The landing was gone, but someone had left a low bench beneath the willow. We sat until the wind brought the leaves down to our shoulders.<sup><a epub:type="noteref" href="#foot">1</a></sup></p>${options.rtl ? '<p>یہ ایک چھوٹی کتاب ہے۔ کِتاب</p>' : ''}${options.vertical ? '<p><ruby>川<rt>かわ</rt></ruby>の流れ</p>' : ''}<aside id="foot" epub:type="footnote">A note from the other shore.</aside>${bad}`, viewport + writing)],
    ['two.xhtml', xhtml('<h1>Second bank</h1><p>A small kingfisher crossed the river.</p>', viewport + writing)],
  ])
  extras.forEach((id, index) => files.set(id + '.xhtml', xhtml('<h1>Chapter ' + (index + 3) + '</h1><p>Further down the river.</p>', viewport + writing)))
  if (options.drm) files.set('META-INF/rights.xml', '<rights/>')
  if (options.traversal) files.set('xx/unsafe.xhtml', '<html/>')
  for (const [path, content] of files)
    await zip.add(path, new TextReader(content), { level: path === 'mimetype' ? 0 : 6 })
  const bytes = Buffer.from(await zip.close())
  if (options.traversal) {
    let offset = bytes.indexOf('xx/unsafe.xhtml')
    while (offset >= 0) {
      bytes.write('..', offset)
      offset = bytes.indexOf('xx/unsafe.xhtml', offset + 2)
    }
  }
  if (options.bomb) {
    for (let offset = 0; offset + 28 < bytes.length; offset++) {
      if (bytes.readUInt32LE(offset) !== 0x02014b50) continue
      if (bytes.subarray(offset + 46, offset + 55).toString() !== 'one.xhtml') continue
      bytes.writeUInt32LE(96 * 1024 * 1024, offset + 24)
      break
    }
  }
  return bytes
}
