// SPDX-License-Identifier: AGPL-3.0-or-later
declare module 'foliate-js/epub.js' {
  export type Contents = { label: string; href: string; subitems?: Contents[] }
  export type Section = {
    id: string
    load: () => Promise<string>
    unload: () => void
    createDocument: () => Promise<Document>
    linear: string
    mediaOverlay?: unknown
  }
  export class EPUB {
    constructor(loader: {
      loadText: (uri: string) => Promise<string | null>
      loadBlob: (uri: string) => Promise<Blob | null>
      getSize: (uri: string) => number
    })
    init(): Promise<this>
    metadata: { title?: string; language?: string }
    rendition: { layout?: string; spread?: string }
    toc?: Contents[]
    pageList?: Contents[]
    resolveHref(href: string): { index: number; anchor?: (doc: Document) => Element | Range | number | null } | null
    dir?: string
    sections: Section[]
    destroy(): void
  }
}

declare module 'foliate-js/view.js' {
  import type { EPUB } from 'foliate-js/epub.js'

  type SearchHit = { cfi: string; excerpt: { pre: string; match: string; post: string } }
  export type SearchResult = 'done' | { label: string; subitems: SearchHit[] } | { progress: number }
  export class View extends HTMLElement {
    book: EPUB
    isFixedLayout: boolean
    renderer: HTMLElement & {
      setStyles?: (style: string) => void
      getContents?: () => { doc: Document; index: number }[]
      zoomAt?: (change: () => void, point?: { x: number; y: number }) => void
    }
    lastLocation?: { cfi: string; fraction?: number; pageItem?: { label: string }; section?: { current: number; total: number } }
    open(book: EPUB): Promise<void>
    init(options: { lastLocation?: string; showTextStart?: boolean }): Promise<void>
    goTo(target: string | number): Promise<{ index: number } | undefined>
    next(): Promise<void>
    prev(): Promise<void>
    goLeft(): Promise<void>
    goRight(): Promise<void>
    close(): void
    search(options: { query: string; matchDiacritics: boolean }): AsyncGenerator<SearchResult>
    clearSearch(): void
  }
}
