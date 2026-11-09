// SPDX-License-Identifier: AGPL-3.0-or-later
type Command = { kind: 'open'; file: File } | { kind: 'read'; path: string; limit: number }
type Pending = { resolve: (result: unknown) => void; reject: (error: Error) => void; timer: number }

export class Archive {
  readonly worker = new Worker(new URL('./archive.worker.ts', import.meta.url), { type: 'module' })
  readonly pending = new Map<number, Pending>()
  sizes = new Map<string, number>()
  sequence = 0
  closed = false

  constructor() {
    this.worker.addEventListener('message', ({ data }) => {
      const request = this.pending.get(data.id)
      if (!request) return
      clearTimeout(request.timer)
      this.pending.delete(data.id)
      if (data.error) request.reject(new Error(data.error))
      else request.resolve(data.result)
    })
    this.worker.addEventListener('error', () => this.close('This book could not be unpacked safely.'))
  }

  request<T>(command: Command): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.closed) {
        reject(new Error('This book is closed.'))
        return
      }
      const id = ++this.sequence
      const timer = window.setTimeout(() => this.close('This EPUB took too long to unpack safely.'), 12_000)
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer })
      this.worker.postMessage({ ...command, id })
    })
  }

  async open(file: File) {
    this.sizes = new Map(await this.request<readonly [string, number][]>({ kind: 'open', file }))
  }

  read(path: string, limit: number) {
    if (!this.sizes.has(path)) return Promise.resolve(null)
    return this.request<ArrayBuffer | null>({ kind: 'read', path, limit })
  }

  async text(path: string, limit = 4 * 1024 * 1024) {
    const bytes = await this.read(path, limit)
    if (!bytes) return null
    const data = new Uint8Array(bytes)
    const encoding = data[0] === 0xff && data[1] === 0xfe ? 'utf-16le'
      : data[0] === 0xfe && data[1] === 0xff ? 'utf-16be' : 'utf-8'
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
    if (/<!\s*ENTITY\b|<!DOCTYPE[^>]*\[/i.test(text))
      throw new Error('This book contains an unsupported XML declaration.')
    return text
  }

  close(message = 'This book is closed.') {
    this.closed = true
    this.worker.terminate()
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(new Error(message))
    }
    this.pending.clear()
  }
}
