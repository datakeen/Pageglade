// SPDX-License-Identifier: AGPL-3.0-or-later
import type { EPUB, Contents } from 'foliate-js/epub.js'

type Anchor = (doc: Document) => Element | Range | number | null
type Overlay = { element: SVGElement; redraw(): void }
type Target = { index: number; anchor?: Anchor; select?: boolean }
type PageLabel = { label: string; previous?: string; anchor?: Anchor }
type Card = {
  index: number
  element: HTMLElement
  start: HTMLElement
  end: HTMLElement
  layer: HTMLElement
  frame: HTMLIFrameElement
  ready: Promise<void>
  stop: () => void
  doc?: Document
  style?: HTMLStyleElement
  observer?: ResizeObserver
  overlay?: Overlay
  labels: HTMLElement[]
  scale: number
}

const sheet = [
  ':host{display:block;width:100%;height:100%}',
  '.viewport{width:100%;height:100%;overflow:auto;overflow-anchor:none;overscroll-behavior:contain}',
  '.stack{display:flex;flex-direction:column;min-width:100%;min-height:100%}',
  '.card{position:relative;display:flex;flex-direction:column;align-items:safe center;flex:none;min-width:100%}',
  '.frame-box{position:relative;flex:none;direction:ltr}',
  'iframe{display:block;border:0;transform-origin:top left}',
  '.marker{box-sizing:border-box;color:var(--muted);font:inherit;font-size:.78rem;padding:.4rem .75rem;text-align:center}',
  '.edge{width:100%;border-block:1px solid var(--line)}',
  '.page-break{position:absolute;z-index:1;inset-inline-end:0;pointer-events:none;border-block-start:1px solid var(--line);background:var(--surface);max-width:8rem}',
  ':host(:not([markers])) .marker{display:none}',
  ':host([axis=vertical]) .viewport{direction:rtl}',
  ':host([axis=vertical]) .stack{flex-direction:row;width:max-content;height:100%}',
  ':host([axis=vertical]) .card{flex-direction:row;min-width:0;height:100%;align-items:center}',
  ':host([axis=vertical]) .edge{width:auto;height:100%;writing-mode:vertical-rl;border-block:1px solid var(--line)}',
  ':host([axis=vertical]) .page-break{top:0;inset-inline-end:auto;writing-mode:vertical-rl}',
].join('\n')

function fixedSize(doc: Document) {
  const meta = doc.querySelector('meta[name=viewport]')?.getAttribute('content') ?? ''
  const width = Number(meta.match(/\bwidth\s*=\s*([\d.]+)/i)?.[1])
  const height = Number(meta.match(/\bheight\s*=\s*([\d.]+)/i)?.[1])
  if (width > 0 && height > 0) return { width, height }
  const svg = doc.querySelector('svg')?.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (svg && svg[2] > 0 && svg[3] > 0) return { width: Math.min(svg[2], 16000), height: Math.min(svg[3], 16000) }
  return { width: 800, height: 1100 }
}

function marker(text: string, kind: 'edge' | 'page-break') {
  const element = document.createElement('span')
  element.className = 'marker ' + kind
  element.textContent = text
  return element
}

export class Continuous extends HTMLElement {
  static observedAttributes = ['zoom', 'markers']
  #viewport = document.createElement('div')
  #stack = document.createElement('div')
  #cards = new Map<number, Card>()
  #pageLabels = new Map<number, PageLabel[]>()
  #book!: EPUB
  #fixed = false
  #vertical = false
  #current = -1
  #styles = ''
  #resize = new ResizeObserver(() => this.#remeasure())
  #scheduled = 0
  #stamp = 0
  #jumping = false
  #last = ''

  constructor() {
    super()
    const root = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = sheet
    this.#viewport.className = 'viewport'
    this.#stack.className = 'stack'
    this.#viewport.append(this.#stack)
    root.append(style, this.#viewport)
    this.#viewport.addEventListener('scroll', () => this.#schedule(), { passive: true })
    this.#resize.observe(this.#viewport)
  }

  open(book: EPUB) {
    this.#book = book
    this.#fixed = book.rendition?.layout === 'pre-paginated'
    let previous: string | undefined
    const collect = (items: Contents[]) => {
      for (const item of items) {
        let target
        try { target = book.resolveHref(item.href) } catch { continue }
        if (target && target.index >= 0 && item.label) {
          const list = this.#pageLabels.get(target.index) ?? []
          list.push({ label: item.label, previous, anchor: target.anchor })
          previous = item.label
          this.#pageLabels.set(target.index, list)
        }
        if (item.subitems) collect(item.subitems)
      }
    }
    collect(book.pageList ?? [])
  }

  get #position() {
    return this.#vertical ? -this.#viewport.scrollLeft : this.#viewport.scrollTop
  }

  #move(position: number) {
    if (this.#vertical) this.#viewport.scrollLeft = -position
    else this.#viewport.scrollTop = position
  }

  #leading(element: Element) {
    const frame = element.getBoundingClientRect()
    const area = this.#viewport.getBoundingClientRect()
    return this.#vertical ? area.right - frame.right : frame.top - area.top
  }

  #length(element: Element) {
    const bounds = element.getBoundingClientRect()
    return this.#vertical ? bounds.width : bounds.height
  }

  #visible() {
    return [...this.#cards.values()].sort((a, b) => a.index - b.index)
      .find(card => this.#leading(card.element) + this.#length(card.element) > 3)
      ?? this.#cards.get(this.#current)
  }

  #stabilize(change: () => void) {
    const card = this.#visible()
    const start = card ? this.#leading(card.element) : 0
    change()
    if (card?.element.isConnected) this.#move(this.#position + this.#leading(card.element) - start)
  }

  #adjacent(index: number, direction: -1 | 1) {
    for (let i = index + direction; i >= 0 && i < this.#book.sections.length; i += direction)
      if (this.#book.sections[i].linear !== 'no') return i
    return -1
  }

  #reconcile(index: number) {
    const wanted = new Set([this.#adjacent(index, -1), index, this.#adjacent(index, 1)])
    wanted.delete(-1)
    this.#stabilize(() => {
      for (const [key, card] of this.#cards) if (!wanted.has(key)) this.#remove(card)
      for (const key of [...wanted].sort((a, b) => a - b)) if (!this.#cards.has(key)) this.#add(key)
    })
  }

  #remove(card: Card) {
    this.#cards.delete(card.index)
    card.stop()
    card.observer?.disconnect()
    card.element.remove()
    this.#book.sections[card.index].unload()
  }

  #add(index: number) {
    const element = document.createElement('section')
    element.className = 'card'
    this.#sizeCard(element)
    const name = this.#fixed ? 'Page ' : 'Section '
    const publisher = this.#pageLabels.get(index)
    const number = publisher?.length === 1 && this.#fixed ? publisher[0].label : String(index + 1)
    const description = name + number
    const start = marker('Start of ' + name.toLowerCase() + number, 'edge')
    const end = marker(start.textContent.replace(/^Start/, 'End'), 'edge')
    const layer = document.createElement('div')
    layer.className = 'frame-box'
    layer.style.width = this.#vertical ? '70vw' : '100%'
    layer.style.height = Math.max(50, this.#viewport.clientHeight - 55) + 'px'
    const frame = document.createElement('iframe')
    frame.setAttribute('sandbox', 'allow-same-origin')
    frame.referrerPolicy = 'no-referrer'
    frame.title = description
    const signal = new AbortController()
    const card: Card = {
      index, element, start, end, layer, frame, labels: [], scale: 1,
      ready: Promise.resolve(), stop: () => signal.abort(),
    }
    element.append(start, layer, end)
    const following = [...this.#cards.values()].filter(item => item.index > index)
      .sort((a, b) => a.index - b.index)[0]
    this.#stack.insertBefore(element, following?.element ?? null)
    this.#cards.set(index, card)
    card.ready = this.#load(card, signal.signal).catch(() => {
      if (signal.signal.aborted) return
      this.#stabilize(() => {
        layer.textContent = 'This section could not be displayed.'
        layer.style.padding = '1rem'
      })
    })
  }

  async #load(card: Card, signal: AbortSignal) {
    const section = this.#book.sections[card.index]
    const url = await section.load()
    if (signal.aborted) {
      if (!this.#cards.has(card.index)) section.unload()
      return
    }
    const { frame, layer } = card
    const loaded = new Promise<void>((resolve, reject) => {
      frame.addEventListener('load', () => resolve(), { once: true, signal })
      frame.addEventListener('error', () => reject(new Error('Could not load section.')), { once: true, signal })
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
    frame.src = url
    layer.append(frame)
    await loaded
    if (signal.aborted) return
    const doc = frame.contentDocument
    if (!doc?.body) throw new Error('Could not load section.')
    card.doc = doc
    card.style = doc.createElement('style')
    doc.head.append(card.style)
    this.#styleCard(card)
    this.dispatchEvent(new CustomEvent('load', { detail: { doc, index: card.index } }))
    if (card.index === this.#current && !this.#fixed) this.#setAxis(doc)
    this.#stabilize(() => this.#measure(card))
    this.dispatchEvent(new CustomEvent('create-overlayer', { detail: {
      doc, index: card.index,
      attach: (overlay: Overlay) => {
        card.overlay = overlay
        layer.append(overlay.element)
        this.#measure(card)
      },
    } }))
    card.observer = new ResizeObserver(() => {
      if (!signal.aborted) {
        this.#stabilize(() => this.#measure(card))
        this.#schedule()
      }
    })
    card.observer.observe(doc.body)
    this.#schedule()
  }

  #setAxis(doc: Document) {
    const vertical = /^vertical-rl|^sideways-rl/.test(doc.defaultView?.getComputedStyle(doc.documentElement).writingMode ?? '')
    if (this.#vertical === vertical) return
    this.#vertical = vertical
    this.toggleAttribute('axis', vertical)
    if (vertical) this.setAttribute('axis', 'vertical')
    this.#viewport.scrollLeft = 0
    this.#viewport.scrollTop = 0
    for (const card of this.#cards.values()) {
      this.#styleCard(card)
      this.#measure(card)
    }
  }

  #styleCard(card: Card) {
    if (!card.style || this.#fixed) return
    card.style.textContent = this.#styles
      + '\nhtml{overflow:hidden!important}body{display:flow-root!important;min-block-size:0!important;margin-block:0!important}'
      + (this.#vertical ? 'body{block-size:max-content;max-inline-size:none;margin-inline:0}' : '')
  }

  setStyles(styles: string) {
    this.#styles = styles
    for (const card of this.#cards.values()) this.#styleCard(card)
    this.#remeasure()
  }

  attributeChangedCallback() {
    this.#remeasure()
  }

  #remeasure() {
    if (!this.#cards.size) return
    this.#stabilize(() => {
      for (const card of this.#cards.values()) this.#measure(card)
    })
    this.#schedule()
  }

  #sizeCard(element: HTMLElement) {
    element.style.minHeight = this.#vertical ? '' : this.#viewport.clientHeight + 'px'
    element.style.minWidth = this.#vertical ? Math.floor(this.#viewport.clientWidth * .65) + 'px' : '100%'
  }

  #measure(card: Card) {
    const { doc, frame, layer, element } = card
    this.#sizeCard(element)
    if (!doc?.body) return
    const viewportWidth = this.#viewport.clientWidth
    const viewportHeight = this.#viewport.clientHeight
    if (!viewportWidth || !viewportHeight) return
    let width: number, height: number
    if (this.#fixed) {
      ({ width, height } = fixedSize(doc))
      const zoom = this.getAttribute('zoom') ?? 'fit-page'
      const fitWidth = Math.max(1, viewportWidth - 24) / width
      card.scale = zoom === 'fit-width' ? fitWidth : zoom === 'fit-page'
        ? Math.min(fitWidth, Math.max(1, viewportHeight - 36) / height) : Number(zoom) || 1
    } else if (this.#vertical) {
      height = Math.max(1, viewportHeight - 8)
      frame.style.height = height + 'px'
      if (!frame.style.width) frame.style.width = '1px'
      width = Math.max(viewportWidth * .55, Math.min(2_000_000, doc.body.scrollWidth))
    } else {
      width = viewportWidth
      frame.style.width = width + 'px'
      height = Math.max(1, Math.min(2_000_000, doc.body.scrollHeight + Math.max(0, doc.body.getBoundingClientRect().top)))
    }
    if (!this.#fixed) {
      if (this.#vertical) width = Math.max(width, viewportWidth * .45)
      else height = Math.max(height, viewportHeight - card.start.offsetHeight - card.end.offsetHeight)
    }
    frame.style.width = Math.ceil(width) + 'px'
    frame.style.height = Math.ceil(height) + 'px'
    frame.style.transform = this.#fixed ? 'scale(' + card.scale + ')' : ''
    layer.style.width = Math.ceil(width * card.scale) + 'px'
    layer.style.height = Math.ceil(height * card.scale) + 'px'
    const overlay = card.overlay
    if (overlay) {
      overlay.element.style.width = frame.style.width
      overlay.element.style.height = frame.style.height
      overlay.element.style.transformOrigin = 'top left'
      overlay.element.style.transform = frame.style.transform
      overlay.redraw()
    }
    this.#positionLabels(card)
  }

  #positionLabels(card: Card) {
    const doc = card.doc
    if (!doc) return
    const pages = this.#pageLabels.get(card.index) ?? []
    if (this.#fixed) return
    while (card.labels.length < pages.length) {
      const item = marker('', 'page-break')
      card.labels.push(item)
      card.layer.append(item)
    }
    pages.forEach((page, index) => {
      const point = page.anchor?.(doc)
      const box = typeof point === 'object' && point?.getBoundingClientRect()
      const item = card.labels[index]
      const text = page.previous ? 'End of page ' + page.previous + ' · Start of page ' + page.label : 'Start of page ' + page.label
      if (item.textContent !== text) item.textContent = text
      item.style.top = this.#vertical ? '0' : (box ? Math.max(0, box.top) : 0) + 'px'
      item.style.right = this.#vertical && box ? Math.max(0, card.frame.clientWidth - box.right) + 'px' : ''
    })
  }

  #schedule() {
    if (this.#scheduled) return
    this.#scheduled = requestAnimationFrame(() => {
      this.#scheduled = 0
      if (this.#jumping) return
      const card = this.#visible()
      if (!card?.doc) return
      if (card.index !== this.#current) {
        this.#current = card.index
        if (!this.#fixed) this.#setAxis(card.doc)
        this.#reconcile(card.index)
      }
      this.#relocate(card)
    })
  }

  #rangeAt(card: Card, x: number, y: number) {
    const doc = card.doc
    if (!doc || this.#fixed) return undefined
    const frame = card.frame.getBoundingClientRect()
    const localX = Math.max(1, Math.min(frame.width - 1, x - frame.left))
    const localY = Math.max(1, Math.min(frame.height - 1, y - frame.top))
    const caret = doc.caretPositionFromPoint?.(localX, localY)
    const fallback = caret ? undefined : doc.caretRangeFromPoint?.(localX, localY)
    const node = caret?.offsetNode ?? fallback?.startContainer
    if (node?.nodeType !== Node.TEXT_NODE || !doc.body.contains(node)) return undefined
    const range = doc.createRange()
    range.setStart(node, caret?.offset ?? fallback?.startOffset ?? 0)
    range.collapse(true)
    return range
  }

  #visibleRange(card: Card) {
    const bounds = this.#viewport.getBoundingClientRect()
    const frame = card.frame.getBoundingClientRect()
    const body = card.doc!.body.getBoundingClientRect()
    for (const step of [12, 30, 64, 115]) {
      const x = this.#vertical ? Math.min(frame.right, bounds.right) - step
        : frame.left + body.left + body.width * .45
      const y = this.#vertical ? Math.max(frame.top, bounds.top) + Math.min(frame.height, bounds.height) * .20
        : Math.max(frame.top, bounds.top) + step
      const range = this.#rangeAt(card, x, y)
      if (range) return range
    }
    return undefined
  }

  #relocate(card: Card, known?: Range) {
    if (!card.doc) return
    const leading = -this.#leading(card.layer)
    const length = Math.max(1, this.#length(card.layer))
    const fraction = Math.max(0, Math.min(1, leading / length))
    const range = known ?? this.#visibleRange(card)
    const key = card.index + ':' + Math.round(leading) + ':' + (range?.startOffset ?? '')
    if (this.#last === key && !known) return
    this.#last = key
    this.dispatchEvent(new CustomEvent('relocate', { detail: {
      index: card.index, reason: 'scroll', range, fraction,
      size: Math.min(1, (this.#vertical ? this.#viewport.clientWidth : this.#viewport.clientHeight) / length),
    } }))
  }

  getContents() {
    return [...this.#cards.values()].filter(card => card.doc)
      .sort((a, b) => Number(b.index === this.#current) - Number(a.index === this.#current) || a.index - b.index)
      .map(({ index, doc, overlay }) => ({ index, doc, overlayer: overlay }))
  }

  zoomAt(change: () => void, point?: { x: number; y: number }) {
    const pointed = point && [...this.#cards.values()].find(card => {
      const bounds = card.frame.getBoundingClientRect()
      return point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom
    })
    const card = pointed || this.#visible()
    if (!card?.doc) {
      change()
      return
    }
    const area = this.#viewport.getBoundingClientRect()
    const x = point?.x ?? (area.left + area.right) / 2
    const y = point?.y ?? (area.top + area.bottom) / 2
    const bounds = card.frame.getBoundingClientRect()
    const range = this.#rangeAt(card, x, y)
    const fractionX = (x - bounds.left) / Math.max(1, bounds.width)
    const fractionY = (y - bounds.top) / Math.max(1, bounds.height)
    const oldRect = range?.getBoundingClientRect()
    const oldLeft = this.#viewport.scrollLeft
    change()
    if (this.#fixed) {
      const next = card.frame.getBoundingClientRect()
      this.#viewport.scrollLeft = oldLeft + next.left + fractionX * next.width - x
      this.#viewport.scrollTop += next.top + fractionY * next.height - y
    } else if (range && oldRect) {
      const next = range.getBoundingClientRect()
      const nextFrame = card.frame.getBoundingClientRect()
      const offset = this.#vertical
        ? x - (nextFrame.left + next.left) - (x - bounds.left - oldRect.left)
        : nextFrame.top + next.top - y + (y - bounds.top - oldRect.top)
      this.#move(this.#position + offset)
    }
    this.#schedule()
  }

  async goTo(target: Target | Promise<Target>) {
    const resolved = await target
    if (!resolved || !this.#book.sections[resolved.index]) return
    const stamp = ++this.#stamp
    this.#jumping = true
    this.#current = resolved.index
    this.#reconcile(resolved.index)
    const card = this.#cards.get(resolved.index)!
    try {
      await card.ready
      if (stamp !== this.#stamp || !card.doc) return
      if (!this.#fixed) this.#setAxis(card.doc)
      const anchor = resolved.anchor?.(card.doc)
      const rectangle = typeof anchor === 'object' && anchor?.getBoundingClientRect()
      const base = this.#position + this.#leading(card.element)
      const delta = rectangle
        ? this.#leading(card.frame) - this.#leading(card.element)
          + (this.#vertical ? card.frame.clientWidth - rectangle.right : rectangle.top) * card.scale
        : typeof anchor === 'number' ? this.#length(card.element) * anchor : 0
      this.#move(base + Math.max(0, delta))
      this.#last = ''
      const range = anchor && typeof anchor === 'object' && 'startContainer' in anchor ? anchor : undefined
      this.#relocate(card, range)
    } finally {
      if (stamp === this.#stamp) this.#jumping = false
    }
  }

  async #advance(direction: -1 | 1) {
    const card = this.#visible()
    if (!card || this.#jumping) return
    if (this.#fixed) {
      const next = this.#adjacent(card.index, direction)
      if (next >= 0) await this.goTo({ index: next })
      return
    }
    const distance = (this.#vertical ? this.#viewport.clientWidth : this.#viewport.clientHeight) * .92
    this.#move(this.#position + direction * distance)
  }

  prev() { return this.#advance(-1) }
  next() { return this.#advance(1) }

  destroy() {
    this.#stamp++
    this.#resize.disconnect()
    cancelAnimationFrame(this.#scheduled)
    for (const card of this.#cards.values()) this.#remove(card)
  }
}

customElements.define('pageglade-continuous', Continuous)
