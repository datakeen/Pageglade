# Contributing to Pageglade

Pageglade is free software under AGPL-3.0-or-later. Contributions use the same license.

## Where to start

Thank you for helping. You can test a book, improve the help pages, translate the interface, or write code.

- To share a problem or idea, open Pageglade on GitHub. Click Issues, then New issue. Tell us what you tried, what happened, and whether you used the browser or desktop app. Include a small book you can share if it helps reproduce the issue.
- To suggest a correction to the help pages, open the file on GitHub and click the pencil icon. If asked, click Fork this repository. Make your change and click Commit changes. Choose to create a new branch if GitHub offers that choice, then click Propose changes and Create pull request.
- If you have a question or would like to get in touch directly, use the [Contact Pageglade form](https://tally.so/r/dbNeEK).

## Run the reader

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

Before distributing a build, include NOTICE.md and the bundled licenses, verify the runtime and installer notices for that platform, and give readers an exact link to the corresponding source alongside the download. Keep the build instructions and lockfile with the source.

When reporting a bug, include the version, browser or operating system, and the steps to reproduce it. Use a small shareable book sample.
