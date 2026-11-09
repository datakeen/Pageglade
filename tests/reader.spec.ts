// SPDX-License-Identifier: AGPL-3.0-or-later
import { test, expect, type Page } from '@playwright/test'
import { fixture } from './books'

async function open(page: Page, bytes: Buffer) {
  await page.locator('#book-file').setInputFiles({ name: 'River.epub', mimeType: 'application/epub+zip', buffer: bytes })
}

async function chapter(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector('foliate-view') as unknown as {
      renderer: { getContents: () => { doc: Document }[] }
    } | null
    const doc = view?.renderer?.getContents()[0]?.doc
    if (!doc?.documentElement || !doc.body) return { text: '' }
    return {
      text: doc.body.textContent ?? '',
      sandbox: doc.defaultView?.frameElement?.getAttribute('sandbox'),
      styles: doc.defaultView?.getComputedStyle(doc.documentElement).writingMode,
      dir: doc.documentElement.dir,
      ruby: doc.querySelector('rt')?.textContent,
      script: Boolean(doc.querySelector('script, iframe, form, [onerror]')),
    }
  })
}

test('opens an EPUB without running or requesting book content', async ({ page }) => {
  const network: string[] = []
  page.on('request', request => { if (request.url().includes('tracker.invalid')) network.push(request.url()) })
  await page.goto('/')
  await open(page, await fixture({ hostile: true }))
  await expect(page.locator('#book-title')).toHaveText('River Notes')
  await expect.poll(async () => (await chapter(page)).text).toContain('We watched the river')
  expect(await chapter(page)).toMatchObject({ sandbox: 'allow-same-origin', script: false })
  expect(await page.evaluate(() => 'hijacked' in window)).toBe(false)
  expect(network).toEqual([])
})

test('uses EPUB 2 contents and restores an EPUB CFI after an abrupt close', async ({ page, context }) => {
  await page.goto('/')
  await open(page, await fixture({ epub2: true }))
  await expect(page.locator('#book-title')).toHaveText('River Notes')
  await page.getByRole('button', { name: 'Contents' }).click()
  await page.getByRole('button', { name: 'Second bank' }).click()
  await expect.poll(async () => (await chapter(page)).text).toContain('kingfisher')
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>(resolve => {
      const request = indexedDB.open('pageglade', 1)
      request.onsuccess = () => resolve(request.result)
    })
    const locations = await new Promise<string[]>(resolve => {
      const request = db.transaction('state').objectStore('state').getAll()
      request.onsuccess = () => resolve(request.result.filter(value => typeof value === 'string'))
    })
    const view = document.querySelector('foliate-view') as unknown as { lastLocation: { cfi: string } }
    return locations.includes(view.lastLocation.cfi)
  })).toBe(true)
  await page.close({ runBeforeUnload: false })
  const restarted = await context.newPage()
  await restarted.goto('/')
  await expect(restarted.locator('#book-title')).toHaveText('River Notes')
  await expect.poll(async () => (await chapter(restarted)).text).toContain('kingfisher')
})

test('opens fixed pages and respects RTL and vertical markup', async ({ page }) => {
  await page.goto('/')
  await open(page, await fixture({ fixed: true, rtl: true }))
  await expect(page.locator('#book-title')).toHaveText('River Notes')
  await expect.poll(async () => (await chapter(page)).text).toContain('چھوٹی کتاب')
  expect(await chapter(page)).toMatchObject({ dir: 'rtl', sandbox: 'allow-same-origin' })
  await page.keyboard.press('ArrowLeft')
  await expect.poll(async () => (await chapter(page)).text).toContain('kingfisher')
  await page.getByRole('button', { name: 'Exit' }).click()
  await open(page, await fixture({ vertical: true }))
  await expect(page.locator('#book-title')).toHaveText('River Notes')
  await expect.poll(async () => (await chapter(page)).ruby).toBe('かわ')
  expect((await chapter(page)).styles).toBe('vertical-rl')
})

test('rejects protected, unsafe, oversized and damaged EPUBs', async ({ page }) => {
  await page.goto('/')
  await open(page, await fixture({ drm: true }))
  await expect(page.getByRole('status').first()).toContainText('protected')
  await open(page, await fixture({ traversal: true }))
  await expect(page.getByRole('status').first()).toContainText('unsafe archive path')
  await open(page, await fixture({ bomb: true }))
  await expect(page.getByRole('status').first()).toContainText('safe archive limit')
  await open(page, Buffer.from('Broken book'))
  await expect(page.getByRole('status').first()).toContainText('could not open')
})

test('finds a chapter and changes settings through the command finder', async ({ page }) => {
  await page.goto('/')
  await open(page, await fixture())
  await expect(page.locator('#book-title')).toHaveText('River Notes')
  await page.getByRole('button', { name: 'Find', exact: true }).click()
  await page.getByLabel('Word or phrase').fill('kingfisher')
  await page.getByRole('dialog').getByRole('button', { name: 'Find', exact: true }).click()
  await page.getByRole('button', { name: /kingfisher/ }).click()
  await expect(page.getByRole('dialog', { name: 'Find in this book' })).toBeHidden()
  await expect.poll(async () => (await chapter(page)).text).toContain('kingfisher')
  await page.keyboard.press('Control+k')
  await expect(page.getByRole('dialog', { name: 'What would you like to do?' })).toBeVisible()
  await page.getByLabel('Find a command').fill('make text bigger')
  await page.getByLabel('Find a command').press('Enter')
  await expect(page.getByRole('dialog')).toBeHidden()
  await page.getByRole('button', { name: 'Preferences' }).click()
  await expect(page.locator('#size')).toHaveValue('110')
  await page.getByRole('button', { name: 'Reset' }).click()
  await expect(page.locator('#size')).toHaveValue('100')
})

test('reopens the cached web app and reads with the network off', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.locator('#offline')).toHaveText('Ready to read offline.')
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'A quiet place to read.' })).toBeVisible()
  await open(page, await fixture())
  await expect(page.locator('#book-title')).toHaveText('River Notes')
  await expect.poll(async () => (await chapter(page)).text).toContain('We watched the river')
})
