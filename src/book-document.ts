// SPDX-License-Identifier: AGPL-3.0-or-later
import DOMPurify from 'dompurify'
import { generate, parse, walk } from 'css-tree'
import type { Archive } from './archive'

const XHTML = 'http://www.w3.org/1999/xhtml'
const SVG = 'http://www.w3.org/2000/svg'
const EPUB = 'http://www.idpf.org/2007/ops'
const XLINK = 'http://www.w3.org/1999/xlink'
const MiB = 1024 * 1024
const localBookOrigin = 'https://book.invalid'
const bookPolicy = "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"

export function reference(value: string, currentPath: string) {
  try {
    if (!value.trim() || /^(?:[\w+.-]+:|\/\/)|[\\\u0000-\u001f]/.test(value.trim())) return null
    const base = currentPath.split('/').map(encodeURIComponent).join('/')
    const uri = new URL(value, `${localBookOrigin}/${base}`)
    if (uri.origin !== localBookOrigin || /%2f|%5c|%00/i.test(uri.pathname)) return null
    return { path: decodeURIComponent(uri.pathname.slice(1)), hash: decodeURIComponent(uri.hash.slice(1)) }
  } catch {
    return null
  }
}

function css(input: string, inline = false) {
  if (input.length > 250_000) return ''
  try {
    const tree = parse(input, { context: inline ? 'declarationList' : 'stylesheet' })
    walk(tree, {
      visit: 'Atrule',
      enter(node, item, list) {
        if (!['media', 'supports', 'layer'].includes(node.name.toLowerCase())) list?.remove(item)
      },
    })
    walk(tree, {
      visit: 'Declaration',
      enter(node, item, list) {
        let unsafe = node.property.startsWith('--')
        walk(node.value, value => {
          if (value.type === 'Url' || value.type === 'Raw'
            || value.type === 'Function' && /^(?:url|image|image-set|-webkit-image-set|src|paint)$/i.test(value.name))
            unsafe = true
        })
        if (unsafe) list?.remove(item)
      },
    })
    return generate(tree).replaceAll('<', '\\3c ')
  } catch {
    return ''
  }
}

function rasterInfo(buffer: ArrayBuffer) {
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  if (bytes.length < 24) return null
  if (view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a
    && view.getUint32(12) === 0x49484452)
    return ['image/png', view.getUint32(16), view.getUint32(20)] as const
  if (view.getUint32(0) === 0x47494638)
    return ['image/gif', view.getUint16(6, true), view.getUint16(8, true)] as const
  if (view.getUint16(0) !== 0xffd8) return null
  let i = 2
  while (i + 9 < bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1]
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker))
      return ['image/jpeg', view.getUint16(i + 7), view.getUint16(i + 5)] as const
    const size = view.getUint16(i + 2)
    if (marker === 0xda || size < 2) break
    i += 2 + size
  }
  return null
}

async function imageUrl(buffer: ArrayBuffer, mime: string) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read a book image.'))
    reader.readAsDataURL(new Blob([buffer], { type: mime }))
  })
}

export async function bookDocument(archive: Archive, path: string, images: boolean) {
  const text = await archive.text(path)
  if (!text) throw new Error('A chapter is missing from this book.')
  const source = new DOMParser().parseFromString(text, 'application/xhtml+xml')
  if (source.querySelector('parsererror')) throw new Error('A chapter contains invalid markup.')
  if (source.getElementsByTagName('*').length > 40_000) throw new Error('A chapter is too complex to display safely.')

  const sourceRoot = source.documentElement
  const vector = sourceRoot.namespaceURI === SVG && sourceRoot.localName === 'svg'
  const body = source.getElementsByTagNameNS(XHTML, 'body')[0] ?? source.getElementsByTagName('body')[0]
  if (!vector && !body) throw new Error('This EPUB has an unsupported chapter.')
  const output = document.implementation.createHTMLDocument()
  const root = output.documentElement
  const head = output.head
  const policy = output.createElement('meta')
  policy.httpEquiv = 'Content-Security-Policy'
  policy.content = bookPolicy
  const charset = output.createElement('meta')
  charset.setAttribute('charset', 'utf-8')
  head.prepend(charset, policy)
  root.lang = sourceRoot.getAttribute('lang') ?? sourceRoot.getAttribute('xml:lang') ?? ''
  const dir = sourceRoot.getAttribute('dir')
  if (dir === 'rtl' || dir === 'ltr') root.dir = dir

  const viewport = source.querySelector('meta[name="viewport"]')?.getAttribute('content')
  const dimensions = viewport?.match(/width\s*=\s*(\d+(?:\.\d+)?).*height\s*=\s*(\d+(?:\.\d+)?)/i)
  if (dimensions && Number(dimensions[1]) > 0 && Number(dimensions[2]) > 0
    && Number(dimensions[1]) <= 16000 && Number(dimensions[2]) <= 16000) {
    const meta = output.createElement('meta')
    meta.name = 'viewport'
    meta.content = `width=${dimensions[1]}, height=${dimensions[2]}`
    head.append(meta)
  }

  const styles: string[] = []
  for (const style of Array.from(source.getElementsByTagName('style')).slice(0, 20))
    styles.push(css(style.textContent ?? ''))
  for (const link of Array.from(source.querySelectorAll('link[rel="stylesheet"]')).slice(0, 12)) {
    const target = reference(link.getAttribute('href') ?? '', path)
    const size = target ? archive.sizes.get(target.path) : undefined
    if (target && size && size <= 250_000) styles.push(css(await archive.text(target.path, 250_000) ?? ''))
  }
  const stylesheet = output.createElement('style')
  stylesheet.textContent = styles.join('\n')
  head.append(stylesheet)

  const fragment = DOMPurify.sanitize(vector ? sourceRoot : body, {
    RETURN_DOM_FRAGMENT: true,
    USE_PROFILES: { html: true, svg: true },
    ADD_ATTR: ['epub:type'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: [
      'script', 'style', 'link', 'meta', 'base', 'iframe', 'frame', 'object', 'embed', 'form',
      'input', 'button', 'select', 'textarea', 'video', 'audio', 'source', 'track',
      'foreignobject', 'animate', 'animatecolor', 'animatemotion', 'animatetransform', 'set', 'use', 'discard',
    ],
    FORBID_ATTR: ['srcset', 'ping', 'target', 'download', 'autofocus', 'contenteditable', 'accesskey'],
  })

  const links = Array.from(fragment.querySelectorAll('a'))
  const pictures = Array.from(fragment.querySelectorAll('img, image'))
  const imagePaths = pictures.map(element => reference(
    element.getAttribute('src') ?? element.getAttribute('href')
      ?? element.getAttributeNS(XLINK, 'href') ?? '', path))
  const linksTo = links.map(anchor => reference(anchor.getAttribute('href') ?? '', path))

  for (const element of fragment.querySelectorAll('*')) {
    const style = element.getAttribute('style')
    if (style) element.setAttribute('style', css(style, true))
    for (const name of ['src', 'href', 'xlink:href', 'poster', 'background', 'action', 'formaction', 'cite', 'longdesc'])
      element.removeAttribute(name)
    element.removeAttributeNS(XLINK, 'href')
    if (element.getAttributeNS(EPUB, 'type') === 'noteref' || element.getAttribute('epub:type') === 'noteref')
      element.setAttribute('data-note-link', '')
  }
  for (const [index, link] of links.entries()) {
    const target = linksTo[index]
    if (!target || !archive.sizes.has(target.path)) continue
    const href = target.path.split('/').map(encodeURIComponent).join('/')
    link.setAttribute('data-book-link', href + (target.hash ? '#' + encodeURIComponent(target.hash) : ''))
    link.setAttribute('href', '#')
  }

  if (images) {
    let bytes = 0
    let pixels = 0
    const urls = new Map<string, string>()
    for (const [index, picture] of pictures.slice(0, 150).entries()) {
      const target = imagePaths[index]
      const size = target ? archive.sizes.get(target.path) : undefined
      if (!target || !size || size > 8 * MiB) continue
      if (!urls.has(target.path)) {
        if (bytes + size > 16 * MiB) continue
        const buffer = await archive.read(target.path, 8 * MiB)
        if (!buffer) continue
        const info = rasterInfo(buffer)
        if (!info) continue
        const [mime, width, height] = info
        if (!width || !height || width * height > 16_000_000 || pixels + width * height > 24_000_000) continue
        bytes += size
        pixels += width * height
        urls.set(target.path, await imageUrl(buffer, mime))
      }
      const url = urls.get(target.path)!
      if (picture.namespaceURI === SVG) picture.setAttribute('href', url)
      else picture.setAttribute('src', url)
    }
  }
  output.body.append(fragment)
  for (const node of [sourceRoot, body]) {
    if (!node) continue
    const target = node === sourceRoot ? output.documentElement : output.body
    const styles = node.getAttribute('style')
    if (styles) target.setAttribute('style', css(styles, true))
    const classes = node.getAttribute('class')
    if (classes) target.className = classes
  }
  return output
}
