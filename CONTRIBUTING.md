# Contributing to Pageglade

Pageglade is free software under AGPL-3.0-or-later. Contributions use the same license.

Install Node.js 24 or newer and open PowerShell in the project folder.

```powershell
npm.cmd ci
```

To run the web preview from source:

```powershell
npm.cmd run dev
```

Open the local address shown in the terminal. To test offline use, build the app and open the preview address instead.

```powershell
npm.cmd run build
```

```powershell
npm.cmd run preview
```

For a desktop development run, install the pinned Electron binary once.

```powershell
npm.cmd exec -- install-electron
```

```powershell
npm.cmd run desktop
```

Build before running the browser tests. Install the Chromium test browser or set PLAYWRIGHT_CHROME_CHANNEL to use an already installed Chrome.

```powershell
npm.cmd exec -- playwright install chromium
```

```powershell
npm.cmd test
```

The download chooser accepts approved GitHub release links at build time. Set VITE_DESKTOP_RELEASE_URL for a Releases link or use VITE_DOWNLOAD_WINDOWS, VITE_DOWNLOAD_WINDOWS_PORTABLE, VITE_DOWNLOAD_MAC_ARM64, VITE_DOWNLOAD_MAC_INTEL, VITE_DOWNLOAD_LINUX_APPIMAGE, and VITE_DOWNLOAD_LINUX_DEB for individual assets.

For a change, check the ordinary reader flow, keyboard and touch alternatives, offline use, the fixtures it affects, and the relevant Help and CHANGELOG entries. Keep VERSION, the app version constant, and package metadata aligned. Add the SPDX header to each new source file and credit any bundled library or font in NOTICE.

When reporting a bug, include the version, browser or operating system, and the steps to reproduce it. Use a small shareable book sample.
