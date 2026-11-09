// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  optimizeDeps: { exclude: ['foliate-js'] },
  build: { target: 'es2023' },
  plugins: [{
    name: 'restricted-epub-renderer',
    enforce: 'pre',
    transform(source, id) {
      if (/\/foliate-js\/view\.js$/.test(id)) {
        const start = source.indexOf('const isZip =')
        const end = source.indexOf('class CursorAutohider')
        if (start < 0 || end <= start) this.error('Review the updated foliate-js book loader.')
        // All books enter the renderer through Pageglade's bounded EPUB loader.
        return source.slice(0, start)
          + 'const makeBook = () => { throw new Error("A checked EPUB is required.") };\n'
          + source.slice(end)
            .replace('if (this.isFixedLayout) {', 'if (this.hasAttribute("data-continuous")) { this.renderer = document.createElement("pageglade-continuous") } else if (this.isFixedLayout) {')
            .replace('this.renderer.open(book)', 'this.renderer.open(this.isFixedLayout && this.hasAttribute("data-fixed-single") ? Object.assign(Object.create(book), { rendition: { ...book.rendition, spread: "none" } }) : book)')
      }
      if (!/\/foliate-js\/(paginator|fixed-layout)\.js$/.test(id)) return
      const permissive = /allow-same-origin allow-scripts|allow-scripts allow-same-origin/g
      if (!permissive.test(source)) this.error('Review the updated foliate-js iframe sandbox.')
      return source.replace(permissive, 'allow-same-origin')
    },
  }],
})
