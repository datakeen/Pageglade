# Notices

Pageglade is free and open-source software. Copyright (C) 2026 Ahmed Bilal and contributors. It is distributed under the GNU Affero General Public License, version 3 or later, without warranty. See [LICENSE](LICENSE). Pageglade's own icon, artwork, and sample book use the same license.

The projects below retain their own licenses and copyright notices.

| Project | License | Contribution |
| --- | --- | --- |
| [foliate-js](https://github.com/johnfactotum/foliate-js/tree/78914aef4466eb960965702401634c2cb348e9b1) by John Factotum and contributors | MIT | EPUB navigation, pagination, search, and reading locations. Pageglade adapts the loader and frame permissions at build time. |
| [zip.js 2.24.0](https://github.com/gildas-lormeau/zip.js) by Gildas Lormeau and contributors | BSD-3-Clause | Unpacking EPUBs in the archive worker. |
| [zlib-streams](https://github.com/gildas-lormeau/zlib-streams), [zlib](https://zlib.net/), and Chromium's zlib fork | BSD-3-Clause and Zlib | WebAssembly compression code carried by zip.js. The bundled notice includes the upstream copyright, altered-zlib and Chromium notices. |
| [DOMPurify 3.4.17](https://github.com/cure53/DOMPurify) by Cure53 and contributors | Apache-2.0, one of the upstream dual-license options | Cleaning book markup. |
| [Babel helpers](https://github.com/babel/babel/tree/main/packages/babel-helpers) and regenerator-runtime | MIT | Helpers distributed in DOMPurify, by Sebastian McKenzie, Facebook, and contributors. |
| [CSSTree 3.2.1](https://github.com/csstree/csstree) by Roman Dvornov and contributors | MIT | Reading and writing book styles. |
| [MDN data 2.27.1](https://github.com/mdn/data) and [source-map-js 1.2.2](https://github.com/7rulnik/source-map-js) | CC0-1.0 and BSD-3-Clause, respectively | Data and utilities used by CSSTree. Source-map-js includes code based on Closure Compiler. |
| [Noto Nastaliq Urdu](https://github.com/notofonts/nastaliq) by the Noto Project Authors, packaged by [Fontsource](https://fontsource.org/fonts/noto-nastaliq-urdu) 5.3.0 | OFL-1.1 | Urdu reading font. |
| [Vite 8.3.7](https://github.com/vitejs/vite) and [Rolldown 1.2.18](https://github.com/rolldown/rolldown) | MIT | Builds and generated JavaScript helpers. |
| [Electron 45.2.3](https://github.com/electron/electron), including [Chromium](https://www.chromium.org/) and [Node.js](https://nodejs.org/) | MIT and the licenses in the runtime notices | Desktop runtime. |

[TypeScript](https://github.com/microsoft/TypeScript), [Playwright](https://github.com/microsoft/playwright), and [electron-builder](https://github.com/electron-userland/electron-builder) support type checking, testing, and packaging.

The web build and the desktop application bundle carry this notice and the license texts in `licenses/`. The desktop distribution also carries Electron's license and `LICENSES.chromium.html`, which includes Node.js and the runtime's bundled third-party notices.

The retained [zlib-streams notice](licenses/zlib-streams.txt) comes from [upstream](https://github.com/gildas-lormeau/zlib-streams/blob/ff804b00e19b92715b86951c6847dc4ae65f6f87/LICENSE). The retained [Babel helpers notice](licenses/Babel-helpers.txt) comes from [upstream](https://github.com/babel/babel/blob/98d987201ac1d6e49290b9416b857199fbaad606/packages/babel-helpers/LICENSE).

The [Pageglade repository](https://github.com/datakeen/Pageglade) carries the app source and build instructions. For a distributed build, use the matching source link provided with that build.

## Installer components

- The Windows installer and portable launcher use [NSIS 3.04](https://nsis.sourceforge.io/) from the [electron-builder NSIS 3.0.4.1 bundle](https://github.com/electron-userland/electron-builder-binaries/releases/tag/nsis-3.0.4.1). The [NSIS license file](licenses/NSIS.txt) includes the terms for its compression modules. See the [NSIS 3.04 source](https://svn.code.sf.net/p/nsis/code/NSIS/tags/v304/) and [electron-builder 26.18.0 installer scripts](https://github.com/electron-userland/electron-builder/tree/v26.18.0/packages/app-builder-lib/templates/nsis).
- The Linux AppImage uses the [AppImage type-2 runtime, release 20251108](https://github.com/AppImage/type2-runtime/releases/tag/20251108), from the [electron-builder AppImage 1.0.3 toolset](https://github.com/electron-userland/electron-builder-binaries/releases/tag/appimage%401.0.3). The [runtime notice](licenses/AppImage-runtime.txt) credits the runtime and its statically linked libraries, including [libfuse](licenses/libfuse.txt). See the [matching runtime source, build scripts, and libfuse patches](https://github.com/AppImage/type2-runtime/tree/dd6cebedcbddde9c82f89b011e8e1d40b6e43868). You may modify the AppImage runtime and its libraries and debug those modifications.
