// SPDX-License-Identifier: AGPL-3.0-or-later
import 'foliate-js/view.js'
import type { View } from 'foliate-js/view.js'
import type { Contents } from 'foliate-js/epub.js'
import nastaliq from '@fontsource/noto-nastaliq-urdu/files/noto-nastaliq-urdu-arabic-400-normal.woff2?inline'
import quickHelp from '../docs/Help.md?raw'
import userManual from '../docs/User Manual.md?raw'
import tutorial from '../docs/tutorials/01 Open and read.md?raw'
import referenceManual from '../docs/Reference Manual.md?raw'
import about from '../docs/About.md?raw'
import { identify, openBook } from './book'
import { defaults, get, parsePreferences, save, type Preferences } from './storage'
import { VERSION } from './version'
import './style.css'
import './continuous'
import { bindZoomGestures, type FixedZoom, type ZoomPoint } from './zoom'
import { setupDownloads } from './downloads'

declare global {
  interface Window {
    pageglade?: {
      chooseBook: () => Promise<{ name: string; bytes: Uint8Array<ArrayBuffer> } | null>
      onOpen: (callback: (book: { name: string; bytes: Uint8Array<ArrayBuffer> }) => void) => void
      quit: () => void
    }
  }
}

function element<T extends HTMLElement = HTMLElement>(id: string) {
  return document.getElementById(id) as T
}

const welcome = element('welcome')
const reader = element('reader')
const status = element('status')
const bookInput = element<HTMLInputElement>('book-file')
const settingsInput = element<HTMLInputElement>('settings-file')
const resume = element<HTMLButtonElement>('resume')
const systemTheme = matchMedia('(prefers-color-scheme: dark)')
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
type Session = Awaited<ReturnType<typeof openBook>> & {
  id: string; view: View; file: File; saved: boolean; lastRecorded?: string; recordTimer?: number
}
let active: Session | undefined
let lastBook: string | undefined
let preferences = { ...defaults }
let busy = false
let opening: AbortController | undefined
let searching = 0
let writeQueue = Promise.resolve()

function say(message = '') {
  status.textContent = message
}

function label(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const found = Object.values(value).find(value => typeof value === 'string')
    if (typeof found === 'string') return found
  }
  return fallback
}

function record(session: Session, cfi: string) {
  if (!session.saved || !cfi || session.lastRecorded === cfi) return
  session.lastRecorded = cfi
  writeQueue = writeQueue.then(async () => {
    await save('state', { ['cfi:' + session.id]: cfi, lastBook: session.id })
    lastBook = session.id
  }).catch(() => {
    session.lastRecorded = undefined
    say('Pageglade could not save your reading position.')
  })
}

function setReading(reading: boolean) {
  for (const item of document.querySelectorAll<HTMLElement>('[data-reading]')) item.hidden = !reading
  welcome.hidden = reading
  reader.hidden = !reading
  resume.hidden = !lastBook
  element('book-title').textContent = active ? label(active.epub.metadata.title, active.file.name) : ''
  if (!reading) setFocus(false)
}

function setFocus(focus: boolean) {
  document.body.classList.toggle('focus', focus)
  const button = element('focus')
  button.setAttribute('aria-pressed', String(focus))
  button.textContent = focus ? 'Leave focus' : 'Focus'
}

function applySettings(view = active?.view) {
  document.documentElement.dataset.theme = preferences.theme === 'system'
    ? systemTheme.matches ? 'dark' : 'light' : preferences.theme
  if (!view?.renderer) return
  const palette = getComputedStyle(document.documentElement)
  const paper = palette.getPropertyValue('--surface').trim()
  const text = palette.getPropertyValue('--text').trim()
  const accent = palette.getPropertyValue('--accent').trim()
  view.renderer.toggleAttribute('markers', preferences.markers)
  if (view.isFixedLayout) {
    const zoom = preferences.fixedZoom
    view.renderer.setAttribute('zoom', typeof zoom === 'number' ? String(zoom / 100) : zoom)
    updateZoomControl(view)
    return
  }
  const renderer = view.renderer
  updateZoomControl(view)
  renderer.setAttribute('max-column-count', preferences.layout === 'spread' ? '2' : '1')
  renderer.setAttribute('margin', preferences.margin === 'wide' ? '46px' : preferences.margin === 'narrow' ? '14px' : '28px')
  renderer.toggleAttribute('animated', !reducedMotion.matches)
  const family = {
    publisher: '', serif: 'Georgia, serif', sans: 'system-ui, sans-serif', nastaliq: '"Pageglade Nastaliq", serif',
  }[preferences.font]
  renderer.setStyles?.(`
    @font-face {font-family:"Pageglade Nastaliq";src:url("${nastaliq}") format("woff2");font-display:swap;}
    :root {color:${text};background:${paper};font-size:${preferences.size}% !important;}
    :root:lang(ur) {font-family:"Pageglade Nastaliq",serif;}
    body {background:transparent !important;}
    ${document.documentElement.dataset.theme === 'dark' ? 'body, p, li, blockquote, span, h1, h2, h3, h4 {color:inherit !important;background-color:transparent !important;}' : ''}
    a[data-book-link] {color:${accent} !important;text-underline-offset:.15em;}
    ${family ? `body, p, li, blockquote, span {font-family:${family} !important;}` : ''}
    ${preferences.spacing === 'publisher' ? '' : `body,p,li,blockquote {line-height:${preferences.spacing === 'wide' ? 1.95 : 1.55} !important;}`}
    ${preferences.alignment === 'publisher' ? '' : `body,p,li {text-align:${preferences.alignment} !important;}`}
    ${preferences.layout === 'scroll' ? `html{scrollbar-width:none}
      body{box-sizing:border-box;max-inline-size:50rem;margin-inline:auto;padding:${preferences.margin === 'wide' ? '2.5rem' : preferences.margin === 'narrow' ? '.75rem' : '1.5rem'};}
    ` : ''}
    img,svg {max-inline-size:100%;}
    :focus-visible {outline:2px solid currentColor;outline-offset:3px;}
  `)
}

function syncControls() {
  for (const [id, value] of Object.entries(preferences)) {
    const control = document.getElementById(id) as HTMLInputElement | null
    if (!control) continue
    if (typeof value === 'boolean') control.checked = value
    else control.value = String(value)
  }
  element<HTMLSelectElement>('reader-layout').value = preferences.layout
  element('size-label').textContent = preferences.size + '%'
}

function savePreferences() {
  const settings = preferences
  writeQueue = writeQueue.then(() => save('state', { preferences: settings }))
    .catch(() => say('Pageglade could not save your preferences.'))
}

function setPreferences(next: Preferences, point?: ZoomPoint) {
  const previous = preferences
  const session = active
  const view = session?.view
  const differentLayout = next.layout !== previous.layout
  const switchRenderer = differentLayout && view && (view.isFixedLayout
    || next.layout === 'scroll' || previous.layout === 'scroll')
  if (switchRenderer && busy) {
    syncControls()
    return
  }
  preferences = next
  const anchor = view?.lastLocation?.cfi
  syncControls()
  if (switchRenderer && session) {
    void startBook(session.file, session.id, anchor).then(opened => {
      if (!opened && active === session) {
        preferences = { ...preferences, layout: previous.layout }
        syncControls()
      }
      savePreferences()
    })
    return
  }
  if (view?.renderer?.zoomAt) {
    const fixedChanged = view.isFixedLayout && next.fixedZoom !== previous.fixedZoom
    if (point || fixedChanged) view.renderer.zoomAt(() => applySettings(view), point)
    else {
      applySettings(view)
      if (anchor && (next.size !== previous.size || next.font !== previous.font
        || next.spacing !== previous.spacing || next.margin !== previous.margin
        || next.markers !== previous.markers)) void view.goTo(anchor)
    }
  } else {
    if (view?.isFixedLayout && next.fixedZoom !== previous.fixedZoom) {
      const renderer = view.renderer
      const doc = renderer.getContents?.()[0]?.doc
      const frame = doc?.defaultView?.frameElement
      const before = frame?.getBoundingClientRect()
      applySettings(view)
      if (frame && before && before.width && before.height) {
        const x = point?.x ?? before.left + before.width / 2
        const y = point?.y ?? before.top + before.height / 2
        const after = frame.getBoundingClientRect()
        renderer.scrollLeft += after.left + (x - before.left) * after.width / before.width - x
        renderer.scrollTop += after.top + (y - before.top) * after.height / before.height - y
      }
    } else {
      applySettings()
      if (view && anchor && !view.isFixedLayout)
        requestAnimationFrame(() => { if (active?.view === view) void view.goTo(anchor) })
    }
  }
  savePreferences()
}

function currentZoom() {
  const view = active?.view
  if (!view || busy || document.querySelector('dialog[open]')) return undefined
  if (!view.isFixedLayout) return preferences.size
  if (typeof preferences.fixedZoom === 'number') return preferences.fixedZoom
  const frame = view.renderer.getContents?.()[0]?.doc.defaultView?.frameElement
  return frame instanceof HTMLElement && frame.offsetWidth
    ? Math.round(100 * frame.getBoundingClientRect().width / frame.offsetWidth) : 100
}

function updateZoomControl(view: View) {
  const value = view.isFixedLayout ? preferences.fixedZoom : preferences.size
  element('zoom-value').textContent = typeof value === 'number' ? value + '%'
    : value === 'fit-width' ? 'Fit width' : 'Fit page'
  const min = view.isFixedLayout ? 50 : 75
  const max = view.isFixedLayout ? 300 : 200
  element<HTMLButtonElement>('zoom-out').disabled = typeof value === 'number' && value <= min
  element<HTMLButtonElement>('zoom-in').disabled = typeof value === 'number' && value >= max
}

function setZoom(value: FixedZoom, point?: ZoomPoint) {
  if (!active || busy) return
  if (active.view.isFixedLayout) {
    const fixedZoom = typeof value === 'number' ? Math.max(50, Math.min(300, Math.round(value))) : value
    if (preferences.fixedZoom !== fixedZoom) setPreferences({ ...preferences, fixedZoom }, point)
  } else {
    const size = typeof value === 'number' ? Math.max(75, Math.min(200, Math.round(value / 5) * 5)) : 100
    if (preferences.size !== size) setPreferences({ ...preferences, size }, point)
  }
}

function adjustZoom(change: number, point?: ZoomPoint, base = currentZoom()) {
  if (base !== undefined) setZoom(base + change, point)
}

function resetZoom() {
  setZoom(active?.view.isFixedLayout ? 'fit-page' : 100)
}

function showZoom() {
  if (!active) return
  const fixed = active.view.isFixedLayout
  const dialog = element<HTMLDialogElement>('zoom-dialog')
  const presets = element('zoom-presets')
  element('zoom-help').textContent = fixed ? 'Magnify the whole page.' : 'Resize text and keep it within the reading area.'
  presets.replaceChildren()
  const values: FixedZoom[] = fixed
    ? ['fit-page', 'fit-width', 75, 100, 125, 150, 200, 300] : [75, 100, 125, 150, 175, 200]
  for (const value of values) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = typeof value === 'number' ? value + '%' : value === 'fit-width' ? 'Fit width' : 'Fit page'
    button.addEventListener('click', () => { dialog.close(); setZoom(value) })
    presets.append(button)
  }
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.textContent = 'Reset zoom'
  reset.addEventListener('click', () => { dialog.close(); resetZoom() })
  presets.append(reset)
  showDialog('zoom-dialog')
}

function showDialog(id: string) {
  const dialog = element<HTMLDialogElement>(id)
  if (!dialog.open) dialog.showModal()
}

function showDetail(title: string, content: Node) {
  element('detail-title').textContent = title
  element('detail-content').replaceChildren(content)
  showDialog('detail-dialog')
}

async function follow(session: Session, href: string, note: boolean) {
  if (note) {
    try {
      const [path, hash] = href.split('#')
      const section = session.epub.sections.find(item => item.id === decodeURIComponent(path))
      const doc = section && hash ? await section.createDocument() : null
      const target = doc?.getElementById(decodeURIComponent(hash ?? ''))
      if (target && active === session) {
        showDetail('Footnote', document.createTextNode(target.textContent?.trim() ?? ''))
        return
      }
    } catch {
      say('This footnote could not be shown.')
    }
  }
  if (active === session) await session.view.goTo(href)
}

function bindChapter(session: Session, doc: Document) {
  if (!doc.defaultView) return
  const frame = doc.defaultView.frameElement
  if (frame && !frame.getAttribute('title')) frame.setAttribute('title', 'Book page')
  bindZoomGestures(doc, adjustZoom, () => active === session ? currentZoom() : undefined, frame)
  doc.addEventListener('keydown', event => shortcut(event), true)
  doc.addEventListener('contextmenu', event => {
    if (doc.getSelection()?.toString()) return
    event.preventDefault()
    if (active === session) showCommands()
  })
  const activate = (event: Event) => {
    const node = event.target as Element | null
    const link = node?.closest?.('a[data-book-link]')
    const href = link?.getAttribute('data-book-link')
    if (href) {
      event.preventDefault()
      event.stopImmediatePropagation()
      void follow(session, href, link!.hasAttribute('data-note-link'))
    }
    const image = node?.closest?.('img[src]') as HTMLImageElement | null
    if (image && !link && /^data:image\/(png|jpeg|gif);base64,/.test(image.src)) {
      const zoom = document.createElement('img')
      zoom.src = image.src
      zoom.alt = image.alt
      showDetail('Book image', zoom)
    }
  }
  doc.addEventListener('click', activate, true)
  for (const image of doc.querySelectorAll<HTMLImageElement>('img[src]')) {
    if (image.closest('a')) continue
    image.tabIndex = 0
    image.setAttribute('role', 'button')
    image.setAttribute('aria-label', image.alt ? 'Enlarge image: ' + image.alt : 'Enlarge book image')
    image.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') activate(event)
    })
  }
}

function dispose(session: Session) {
  clearTimeout(session.recordTimer)
  session.view.close()
  session.view.remove()
  session.close()
}

async function startBook(file: File, knownId?: string, position?: string) {
  if (busy) return false
  busy = true
  const attempt = new AbortController()
  opening = attempt
  const { signal } = attempt
  const timeout = window.setTimeout(() => attempt.abort(new Error('This EPUB took too long to open safely.')), 25_000)
  say('Opening your book…')
  let candidate: Session | undefined
  try {
    const book = await openBook(file, signal)
    const view = document.createElement('foliate-view') as View
    view.toggleAttribute('data-continuous', preferences.layout === 'scroll')
    view.toggleAttribute('data-fixed-single', preferences.layout === 'single')
    candidate = { ...book, id: '', view, file, saved: false }
    const session = candidate
    session.id = knownId ?? await identify(file)
    signal.throwIfAborted()
    const cfi = position ?? await get<string>('state', 'cfi:' + session.id).catch(() => undefined)
    signal.throwIfAborted()
    view.style.visibility = 'hidden'
    reader.hidden = false
    welcome.hidden = true
    reader.append(view)
    view.addEventListener('external-link', event => event.preventDefault())
    view.addEventListener('load', event => bindChapter(session, (event as CustomEvent<{ doc: Document }>).detail.doc))
    view.addEventListener('relocate', () => {
      if (active !== session || !view.lastLocation) return
      updateLocation(view)
      clearTimeout(session.recordTimer)
      session.recordTimer = window.setTimeout(() => {
        if (active === session && view.lastLocation) record(session, view.lastLocation.cfi)
      }, 150)
    })
    await Promise.race([
      (async () => {
        await view.open(book.epub)
        signal.throwIfAborted()
        applySettings(view)
        await view.init({ lastLocation: cfi, showTextStart: true })
        signal.throwIfAborted()
        if (!view.lastLocation) await view.goTo(0)
      })(),
      new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })),
    ])
    signal.throwIfAborted()
    if (!view.lastLocation) throw new Error('The first page could not be displayed.')
    clearTimeout(timeout)
    opening = undefined
    if (active) dispose(active)
    active = session
    candidate = undefined
    searching++
    view.style.visibility = ''
    setReading(true)
    updateLocation(view)
    say(cfi ? 'Continued from your saved place.' : '')
    try {
      if (!knownId && !await get<File>('books', session.id)) await save('books', { [session.id]: file })
      session.saved = true
      record(session, view.lastLocation.cfi)
    } catch {
      say('Your book is open. There is no space to keep a local copy for next time.')
    }
    reader.focus()
    return true
  } catch (error) {
    if (candidate) dispose(candidate)
    if (signal.reason?.name === 'AbortError') return false
    setReading(Boolean(active))
    const cause = signal.reason ?? error
    const message = cause instanceof Error ? cause.message : ''
    say(/^This |^The archive |^Pages |^A chapter |^There are no |^Part of/.test(message)
      ? message : 'Pageglade could not open this EPUB. Try another copy of the book.')
    return false
  } finally {
    clearTimeout(timeout)
    if (opening === attempt) opening = undefined
    busy = false
  }
}

function updateLocation(view: View) {
  const { pageItem, section } = view.lastLocation ?? {}
  element('location').textContent = pageItem?.label ? 'Page ' + pageItem.label
    : section ? (view.isFixedLayout ? 'Page ' : 'Section ') + (section.current + 1) + ' of ' + section.total
    : 'Reading'
}

async function chooseBook() {
  if (!window.pageglade) {
    bookInput.click()
    return
  }
  try {
    const book = await window.pageglade.chooseBook()
    if (book) await startBook(new File([book.bytes], book.name))
  } catch {
    say('Pageglade could not read that file. Try opening another copy.')
  }
}

async function continueBook(id = lastBook) {
  if (!id) return
  try {
    const file = await get<File>('books', id)
    if (file) await startBook(file, id)
    else say('The saved copy is unavailable. Open the book again to find your place.')
  } catch {
    say('Pageglade could not read its saved copy. Open the book again to continue.')
  }
}

async function leave(quit = true) {
  opening?.abort()
  ++searching
  const session = active
  if (session?.view.lastLocation) record(session, session.view.lastLocation.cfi)
  await writeQueue
  if (session && active === session) {
    dispose(session)
    active = undefined
  }
  setReading(false)
  say()
  if (quit && window.pageglade) window.pageglade.quit()
  else if (!active) resume.hidden ? element('welcome-open').focus() : resume.focus()
}

function navigation(action: 'next' | 'prev' | 'goLeft' | 'goRight') {
  if (!busy) void active?.view[action]().catch(() => say('Pageglade could not turn to that page.'))
}

function itemButton(list: HTMLElement, caption: string, action: () => void) {
  const row = document.createElement('li')
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = caption
  button.addEventListener('click', action)
  row.append(button)
  list.append(row)
  return row
}

function showContents() {
  const session = active
  if (!session) return
  const list = element('chapter-list')
  const dialog = element<HTMLDialogElement>('contents-dialog')
  list.replaceChildren()
  const add = (container: HTMLElement, item: Contents, depth: number) => {
    const row = itemButton(container, item.label || 'Untitled section', () => {
      dialog.close()
      void session.view.goTo(item.href)
    })
    if (depth < 10 && item.subitems?.length) {
      const nested = document.createElement('ol')
      for (const subitem of item.subitems) add(nested, subitem, depth + 1)
      row.append(nested)
    }
  }
  if (session.epub.toc?.length) for (const item of session.epub.toc) add(list, item, 0)
  else session.epub.sections.forEach((_, index) => itemButton(list, `Section ${index + 1}`, () => {
    dialog.close()
    void session.view.goTo(index)
  }))
  showDialog('contents-dialog')
}

async function find(query: string) {
  const session = active
  if (!session || !query) return
  const id = ++searching
  const results = element('find-results')
  const progress = element('find-status')
  const dialog = element<HTMLDialogElement>('find-dialog')
  results.replaceChildren()
  progress.textContent = 'Looking through the book…'
  let hits = 0
  try {
    for await (const result of session.view.search({ query: query.normalize('NFC'), matchDiacritics: false })) {
      if (id !== searching) return
      if (typeof result === 'string' || !('subitems' in result)) continue
      for (const { cfi, excerpt } of result.subitems) {
        itemButton(results, [excerpt.pre, excerpt.match, excerpt.post].join(''), () => {
          dialog.close()
          void session.view.goTo(cfi)
        })
        if (++hits >= 100) break
      }
      if (hits >= 100) break
    }
    progress.textContent = hits >= 100 ? 'Showing the first 100 matches.' : hits ? `${hits} matches.` : 'No matches.'
  } catch {
    if (id === searching) progress.textContent = 'Pageglade could not finish searching this book.'
  }
}

const commands = [
  { name: 'Open a book', words: 'choose import file', run: chooseBook },
  { name: 'Contents', words: 'chapter jump', run: showContents, reading: true },
  { name: 'Find in this book', words: 'search word text', run: () => showDialog('find-dialog'), reading: true },
  { name: 'Make text bigger', words: 'increase enlarge font size zoom in', run: () => adjustZoom(10), reading: true },
  { name: 'Make text smaller', words: 'decrease reduce font size zoom out', run: () => adjustZoom(-10), reading: true },
  { name: 'Zoom options', words: 'percentage magnification fit page fit width', run: showZoom, reading: true },
  { name: 'Reset zoom', words: 'default actual size', run: resetZoom, reading: true },
  { name: 'Continuous scrolling', words: 'scroll layout', run: () => setPreferences({ ...preferences, layout: 'scroll' }), reading: true },
  { name: 'Preferences', words: 'settings theme spacing layout appearance', run: () => showDialog('preferences-dialog') },
  { name: 'Focus mode', words: 'quiet distractions', run: () => setFocus(!document.body.classList.contains('focus')), reading: true },
  { name: 'Next page', words: 'forward turn', run: () => navigation('next'), reading: true },
  { name: 'Previous page', words: 'back turn', run: () => navigation('prev'), reading: true },
  { name: 'Exit', words: 'leave close quit save', run: leave },
]

function paintCommands() {
  const dialog = element<HTMLDialogElement>('commands-dialog')
  const query = element<HTMLInputElement>('command-query').value.trim().toLocaleLowerCase()
  const words = query.split(/\s+/)
  const list = element('command-results')
  list.replaceChildren()
  for (const { name, words: aliases, run, reading } of commands) {
    if ((reading && !active) || !words.every(word => (name.toLowerCase() + ' ' + aliases).includes(word))) continue
    itemButton(list, name, () => { dialog.close(); void run() })
  }
}

function showCommands() {
  element<HTMLInputElement>('command-query').value = ''
  paintCommands()
  showDialog('commands-dialog')
}

function shortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing || document.querySelector('dialog[open]')) return
  const target = event.target as Element | null
  if (target?.closest?.('input, select, textarea, [contenteditable=true]')) return
  const modifier = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()
  if (modifier && key === 'o') { event.preventDefault(); void chooseBook() }
  if (modifier && key === 'k') { event.preventDefault(); showCommands() }
  if (modifier && key === 'f' && active) { event.preventDefault(); showDialog('find-dialog') }
  if (key === 'escape' && document.body.classList.contains('focus')) setFocus(false)
  if (active && !event.altKey && (!modifier || window.pageglade) && ['+', '=', '-', '0'].includes(key)
    && (target?.ownerDocument !== document || reader.contains(target) || target === document.body)) {
    event.preventDefault()
    if (key === '0') resetZoom()
    else adjustZoom(key === '-' ? -10 : 10)
    return
  }
  if (!active || modifier || event.altKey || event.shiftKey) return
  const turn = { arrowleft: 'goLeft', arrowright: 'goRight', pageup: 'prev', pagedown: 'next' } as const
  if (key in turn) {
    event.preventDefault()
    navigation(turn[key as keyof typeof turn])
  }
}

for (const id of ['open', 'welcome-open']) element(id).addEventListener('click', () => void chooseBook())
bookInput.addEventListener('change', () => {
  const file = bookInput.files?.[0]
  bookInput.value = ''
  if (file) void startBook(file)
})
resume.addEventListener('click', () => void continueBook())
element('exit').addEventListener('click', () => void leave())
document.querySelector('.brand')?.addEventListener('click', event => { event.preventDefault(); void leave(false) })
element('next').addEventListener('click', () => navigation('next'))
element('previous').addEventListener('click', () => navigation('prev'))
element('zoom-out').addEventListener('click', () => adjustZoom(-10))
element('zoom-in').addEventListener('click', () => adjustZoom(10))
element('zoom-value').addEventListener('click', showZoom)
element<HTMLSelectElement>('reader-layout').addEventListener('change', event => {
  const layout = (event.currentTarget as HTMLSelectElement).value as Preferences['layout']
  setPreferences({ ...preferences, layout })
})
bindZoomGestures(reader, adjustZoom, currentZoom)
setupDownloads(Boolean(window.pageglade))
element('focus').addEventListener('click', () => setFocus(!document.body.classList.contains('focus')))
element('contents').addEventListener('click', showContents)
element('find').addEventListener('click', () => showDialog('find-dialog'))
element('find-form').addEventListener('submit', event => {
  event.preventDefault()
  void find(element<HTMLInputElement>('query').value.trim())
})
element('commands').addEventListener('click', showCommands)
element('command-query').addEventListener('input', paintCommands)
element('command-query').addEventListener('keydown', event => {
  if (event.key !== 'Enter') return
  event.preventDefault()
  element('command-results').querySelector('button')?.click()
})
element('preferences').addEventListener('click', () => showDialog('preferences-dialog'))
for (const key of Object.keys(defaults) as (keyof Preferences)[]) {
  const control = document.getElementById(key) as HTMLInputElement | null
  control?.addEventListener('change', () => {
    const value = key === 'markers' ? control.checked : key === 'size' ? Number(control.value) : control.value
    const next = parsePreferences({ ...preferences, [key]: value })
    if (next) setPreferences(next)
  })
}
element('size').addEventListener('input', () => {
  element('size-label').textContent = element<HTMLInputElement>('size').value + '%'
})
element('reset').addEventListener('click', () => setPreferences({ ...defaults }))
element('export').addEventListener('click', () => {
  const link = document.createElement('a')
  link.download = 'Pageglade preferences.json'
  link.href = URL.createObjectURL(new Blob([JSON.stringify({ schema: 1, preferences }, null, 2)], { type: 'application/json' }))
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
})
element('import').addEventListener('click', () => settingsInput.click())
settingsInput.addEventListener('change', async () => {
  const file = settingsInput.files?.[0]
  settingsInput.value = ''
  if (!file) return
  try {
    if (file.size > 16_384) throw new Error()
    const settings = JSON.parse(await file.text())
    const next = settings.schema === 1 ? parsePreferences(settings.preferences) : null
    if (!next) throw new Error()
    setPreferences(next)
    say('Preferences imported.')
  } catch {
    say('Choose a preferences file exported by Pageglade.')
  }
})

const help: Record<string, string> = {
  help: quickHelp, manual: userManual, tutorial, reference: referenceManual, about,
}
function showHelp(key = 'help') {
  const blocks = help[key].trim().split(/\r?\n\r?\n/)
  if (key === 'about') blocks.splice(1, 0, `Version ${VERSION}`)
  const paragraphs = blocks.map(text => {
    const heading = text.startsWith('# ')
    const block = document.createElement(heading ? 'h3' : 'p')
    block.textContent = heading ? text.slice(2) : text
    return block
  })
  element('help-page').replaceChildren(...paragraphs)
  showDialog('help-dialog')
}
element('help').addEventListener('click', () => showHelp())
document.querySelectorAll<HTMLButtonElement>('[data-doc]').forEach(button => {
  button.addEventListener('click', () => showHelp(button.dataset.doc))
})

document.addEventListener('keydown', shortcut)
document.addEventListener('dragover', event => {
  if (!event.dataTransfer?.types.includes('Files')) return
  event.preventDefault()
  document.body.classList.add('dragging')
})
document.addEventListener('dragleave', event => {
  if (!event.relatedTarget) document.body.classList.remove('dragging')
})
document.addEventListener('drop', event => {
  event.preventDefault()
  document.body.classList.remove('dragging')
  const file = event.dataTransfer?.files[0]
  if (file) void startBook(file)
})
systemTheme.addEventListener('change', () => applySettings())
reducedMotion.addEventListener('change', () => applySettings())
window.pageglade?.onOpen(book => void startBook(new File([book.bytes], book.name)))

async function start() {
  try {
    preferences = parsePreferences(await get('state', 'preferences')) ?? { ...defaults }
    lastBook = await get<string>('state', 'lastBook')
  } catch {
    say('This session cannot keep a local copy or save your reading place.')
  }
  syncControls()
  applySettings()
  setReading(Boolean(active))
  if (lastBook && !active && !busy) await continueBook()
}
void start()

if (!window.pageglade && import.meta.env.PROD && 'serviceWorker' in navigator) {
  const offline = element('offline')
  navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready)
    .then(() => { offline.textContent = 'Ready to read offline.' })
    .catch(() => { offline.textContent = 'Offline setup is unavailable in this browser.' })
}
