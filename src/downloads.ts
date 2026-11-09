// SPDX-License-Identifier: AGPL-3.0-or-later
const platforms = [
  ['Windows installer', import.meta.env.VITE_DOWNLOAD_WINDOWS],
  ['Windows portable', import.meta.env.VITE_DOWNLOAD_WINDOWS_PORTABLE],
  ['macOS for Apple chip', import.meta.env.VITE_DOWNLOAD_MAC_ARM64],
  ['macOS for Intel', import.meta.env.VITE_DOWNLOAD_MAC_INTEL],
  ['Linux AppImage', import.meta.env.VITE_DOWNLOAD_LINUX_APPIMAGE],
  ['Linux Debian package', import.meta.env.VITE_DOWNLOAD_LINUX_DEB],
] as const

function releaseURL(input: unknown) {
  if (typeof input !== 'string') return
  try {
    const url = new URL(input)
    if (url.origin === 'https://github.com'
      && /^\/datakeen\/pageglade\/releases(?:\/|$)/i.test(url.pathname)
      && !url.username && !url.password) return url.href
  } catch {
    return
  }
}

export function setupDownloads(desktop: boolean) {
  if (desktop) return
  const dialog = document.querySelector<HTMLDialogElement>('#download-dialog')!
  const list = dialog.querySelector('ul')!
  const message = dialog.querySelector('p')!
  const release = dialog.querySelector<HTMLAnchorElement>('#release-link')!
  let available = false
  for (const [name, asset] of platforms) {
    const row = document.createElement('li')
    const href = releaseURL(asset)
    if (href) {
      const link = document.createElement('a')
      link.href = href
      link.textContent = name
      row.append(link)
      available = true
    } else {
      row.textContent = name + ' · Coming soon'
    }
    list.append(row)
  }
  const releaseHref = releaseURL(import.meta.env.VITE_DESKTOP_RELEASE_URL)
  if (releaseHref) {
    release.href = releaseHref
    release.hidden = false
  }
  message.textContent = available ? 'Choose the installer for your computer.'
    : releaseHref ? 'Open Releases to find the installer for your computer.'
    : 'Desktop installers are coming soon.'
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-download]')) {
    button.hidden = false
    button.addEventListener('click', () => {
      // Avoid trapping the reader in two stacked dialogs.
      button.closest('dialog')?.close()
      dialog.showModal()
    })
  }
}
