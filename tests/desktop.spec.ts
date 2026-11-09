// SPDX-License-Identifier: AGPL-3.0-or-later
import { test, expect, _electron } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fixture } from './books'

test('opens an EPUB passed to the Windows desktop app and exits', async ({}, testInfo) => {
  test.skip(!process.env.PAGEGLADE_DESKTOP_TEST, 'Enable after installing the pinned Electron binary.')
  const bookPath = testInfo.outputPath('River.epub')
  await writeFile(bookPath, await fixture({ hostile: true }))
  const app = await _electron.launch({
    args: [resolve('.'), '--user-data-dir=' + testInfo.outputPath('profile'), bookPath],
  })
  try {
    const window = await app.firstWindow()
    await expect(window.locator('#book-title')).toHaveText('River Notes')
    await expect(window.getByRole('button', { name: 'Next' })).toBeVisible()
    await expect(window.locator('#offline')).toBeEmpty()
    expect(await window.evaluate(() => 'hijacked' in globalThis)).toBe(false)
    const closed = app.waitForEvent('close')
    await window.getByRole('button', { name: 'Exit' }).click().catch(error => {
      // Electron can close before Playwright receives the click response.
      if (!String(error).includes('Target page, context or browser has been closed')) throw error
    })
    await closed
  } finally {
    await app.close().catch(() => {})
  }
})
