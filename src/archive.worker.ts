// SPDX-License-Identifier: AGPL-3.0-or-later
import { BlobReader, ERR_UNSAFE_FILENAME, ZipReader, configure, type FileEntry } from '@zip.js/zip.js'

const MiB = 1024 * 1024
const MAX_FILE = 150 * MiB
const MAX_ENTRY = 64 * MiB
const MAX_EXPANDED = 384 * MiB
const MAX_ENTRIES = 10_000
const entries = new Map<string, FileEntry>()
const seen = new Set<string>()
configure({ useWebWorkers: false, useCompressionStream: true })

async function read(path: string, limit: number) {
  const entry = entries.get(path)
  if (!entry) return null
  if (entry.uncompressedSize > limit) throw new Error('Part of this book is too large to open safely.')
  const buffer = new Uint8Array(entry.uncompressedSize)
  let offset = 0
  const output = new WritableStream<Uint8Array>({
    write(chunk) {
      if (chunk.byteLength > buffer.byteLength - offset)
        throw new Error('The archive expands past its declared size.')
      buffer.set(chunk, offset)
      offset += chunk.byteLength
    },
  })
  await entry.getData(output, { checkSignature: true })
  if (offset !== buffer.byteLength) throw new Error('The archive contains an incomplete entry.')
  return buffer.buffer
}

async function open(file: File) {
  if (file.size > MAX_FILE) throw new Error('This EPUB is larger than the current 150 MB limit.')
  const reader = new ZipReader(new BlobReader(file))
  let expanded = 0
  for await (const entry of reader.getEntriesGenerator()) {
    const path = entry.directory ? entry.filename.replace(/\/$/, '') : entry.filename
    if (!path || /[\\:\u0000-\u001f\u007f]/.test(path)
      || path.split('/').some(part => !part || part === '.' || part === '..')
      || (entry.externalFileAttributes >>> 16 & 0xf000) === 0xa000)
      throw new Error('This EPUB contains an unsafe archive path.')
    const key = path.normalize('NFC').toLowerCase()
    if (seen.has(key)) throw new Error('This EPUB contains duplicate archive paths.')
    seen.add(key)
    if (seen.size > MAX_ENTRIES) throw new Error('This EPUB has too many archive entries.')
    if (entry.directory) continue
    if (entry.encrypted) throw new Error('This book is protected. If you have a DRM-free copy, open that instead.')
    if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0
      || entry.uncompressedSize > MAX_ENTRY || (expanded += entry.uncompressedSize) > MAX_EXPANDED)
      throw new Error('This EPUB expands past the safe archive limit.')
    entries.set(path, entry)
  }
  const mimetype = await read('mimetype', 100)
  if (!mimetype || new TextDecoder().decode(mimetype).trim() !== 'application/epub+zip'
    || !entries.has('META-INF/container.xml'))
    throw new Error('This file is not a readable EPUB.')
  return [...entries].map(([path, entry]) => [path, entry.uncompressedSize] as const)
}

type Request = { id: number } & (
  { kind: 'open'; file: File } | { kind: 'read'; path: string; limit: number }
)

self.addEventListener('message', async (event: MessageEvent<Request>) => {
  const { data } = event
  try {
    const result = data.kind === 'open' ? await open(data.file) : await read(data.path, data.limit)
    self.postMessage({ id: data.id, result }, { transfer: result instanceof ArrayBuffer ? [result] : [] })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid EPUB archive.'
    self.postMessage({
      id: data.id,
      error: message === ERR_UNSAFE_FILENAME ? 'This EPUB contains an unsafe archive path.' : message,
    })
  }
})
