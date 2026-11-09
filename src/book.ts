// SPDX-License-Identifier: AGPL-3.0-or-later
import { EPUB } from 'foliate-js/epub.js'
import { Archive } from './archive'
import { bookDocument } from './book-document'

const maxXml = 4 * 1024 * 1024
const fontObfuscation = new Set(['http://www.idpf.org/2008/embedding', 'http://ns.adobe.com/pdf/enc#RC'])
const protectedBook = 'This book is protected. If you have a DRM-free copy, open that instead.'

export async function openBook(file: File, signal: AbortSignal) {
  const archive = new Archive()
  const urls = new Map<string, string>()
  function close() {
    signal.removeEventListener('abort', close)
    archive.close()
    for (const url of urls.values()) URL.revokeObjectURL(url)
    urls.clear()
  }

  try {
    signal.throwIfAborted()
    signal.addEventListener('abort', close, { once: true })
    await archive.open(file)
    if (['META-INF/license.lcpl', 'META-INF/rights.xml'].some(path => archive.sizes.has(path)))
      throw new Error(protectedBook)
    const encryption = await archive.text('META-INF/encryption.xml', maxXml)
    if (encryption) {
      const doc = new DOMParser().parseFromString(encryption, 'application/xml')
      const entries = Array.from(doc.getElementsByTagNameNS('http://www.w3.org/2001/04/xmlenc#', 'EncryptedData'))
      if (doc.querySelector('parsererror') || !entries.length || entries.some(entry => {
        const methods = entry.getElementsByTagNameNS('http://www.w3.org/2001/04/xmlenc#', 'EncryptionMethod')
        return methods.length !== 1 || !fontObfuscation.has(methods[0].getAttribute('Algorithm') ?? '')
      })) throw new Error(protectedBook)
    }

    const epub = await new EPUB({
      loadText: path => archive.text(path, maxXml),
      loadBlob: async () => null,
      getSize: path => archive.sizes.get(path) ?? 0,
    }).init()
    signal.throwIfAborted()
    if (!epub.sections.length) throw new Error('There are no readable pages in this EPUB.')
    if (epub.sections.some(section => !archive.sizes.has(section.id)))
      throw new Error('Pages are missing from this EPUB.')
    for (const section of epub.sections) {
      section.createDocument = () => bookDocument(archive, section.id, false)
      section.load = async () => {
        const prior = urls.get(section.id)
        if (prior) return prior
        const doc = await bookDocument(archive, section.id, true)
        if (archive.closed) throw new Error('This book is closed.')
        const url = URL.createObjectURL(new Blob(['<!doctype html>', doc.documentElement.outerHTML], { type: 'text/html;charset=utf-8' }))
        const existing = urls.get(section.id)
        if (existing) {
          URL.revokeObjectURL(url)
          return existing
        }
        urls.set(section.id, url)
        return url
      }
      section.unload = () => {
        const url = urls.get(section.id)
        if (url) URL.revokeObjectURL(url)
        urls.delete(section.id)
      }
      section.mediaOverlay = undefined
    }
    return { epub, close }
  } catch (error) {
    close()
    throw error
  }
}

export async function identify(file: File) {
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}
