# Reference manual

Pageglade reads local EPUBs and stores book copies, EPUB CFI locations, and preferences in IndexedDB. Book identity comes from a SHA-256 digest of its bytes.

The EPUB adapter checks archive entries in a worker. It cleans XHTML and CSS and creates script-disabled reading frames with a separate content policy. EPUB navigation, saved anchors, and paged views use foliate-js. Continuous view keeps the visible section and its immediate neighbors mounted in the same scroll area. Page markers live outside the chapter document.

Desktop uses a local Electron protocol and a small preload for user-selected file opening. The web version caches the built static files using a service worker.
