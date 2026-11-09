// SPDX-License-Identifier: AGPL-3.0-or-later
import { expect, test, type Page } from '@playwright/test'
import { fixture } from './books'

async function open(page: Page, options: Parameters<typeof fixture>[0] = {}) {
  await page.goto('/')
  await page.locator('#book-file').setInputFiles({
    name: 'River.epub', mimeType: 'application/epub+zip', buffer: await fixture(options),
  })
  await expect(page.locator('#book-title')).toHaveText('River Notes')
}

function surface(page: Page, action: 'forward' | 'back' | 'read') {
  return page.evaluate(action => {
    const renderer = (document.querySelector('foliate-view') as unknown as {
      renderer: HTMLElement
    }).renderer
    const root = renderer.shadowRoot!
    const viewport = root.querySelector<HTMLElement>('.viewport')!
    if (action !== 'read') {
      const distance = (action === 'forward' ? 1 : -1) * viewport.clientHeight
      viewport.scrollBy({ top: distance })
    }
    return {
      markers: Array.from(root.querySelectorAll('.marker')).filter(el => el.getClientRects().length).map(el => el.textContent),
      frames: root.querySelectorAll('iframe').length,
    }
  }, action)
}

test('scrolls across sections with a bounded set of book frames and default markers', async ({ page }) => {
  await open(page, { extraSections: 4 })
  await expect(page.getByLabel('Reading layout')).toHaveValue('scroll')
  await expect(page.locator('#location')).toHaveText('Section 1 of 6')
  const initial = await surface(page, 'read')
  expect(initial.markers).toContain('Start of section 1')
  expect(initial.markers).toContain('End of section 1')
  await page.mouse.move(200, 220)
  await page.mouse.wheel(0, 1100)
  await expect(page.locator('#location')).toHaveText('Section 2 of 6')
  for (let index = 3; index <= 5; index++) {
    await surface(page, 'forward')
    await expect(page.locator('#location')).toHaveText('Section ' + index + ' of 6')
  }
  expect((await surface(page, 'read')).frames).toBeLessThanOrEqual(3)
  await surface(page, 'back')
  await expect(page.locator('#location')).toHaveText('Section 4 of 6')
  await page.getByRole('button', { name: 'Preferences' }).click()
  await page.getByLabel('Start and end markers').uncheck()
  await page.getByRole('button', { name: 'Done' }).click()
  expect((await surface(page, 'read')).markers).toEqual([])
  await expect(page.locator('#location')).toHaveText('Section 4 of 6')
  await page.getByLabel('Reading layout').selectOption('single')
  await expect(page.locator('foliate-view[data-continuous]')).toHaveCount(0)
  await expect(page.locator('#location')).toHaveText('Section 4 of 6')
  await page.getByLabel('Reading layout').selectOption('scroll')
  await expect(page.locator('foliate-view[data-continuous]')).toHaveCount(1)
  await expect(page.locator('#location')).toHaveText('Section 4 of 6')
})

test('zooms reflowable text with buttons, keyboard, mouse wheel and reset', async ({ page }) => {
  await open(page)
  const zoom = page.getByRole('button', { name: 'Zoom options' })
  await expect(zoom).toHaveText('100%')
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(zoom).toHaveText('110%')
  await page.locator('#reader').focus()
  await page.keyboard.press('+')
  await expect(zoom).toHaveText('120%')
  await page.mouse.move(220, 220)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, -180)
  await page.keyboard.up('Control')
  await expect(zoom).toHaveText('130%')
  await zoom.click()
  await page.getByRole('button', { name: '150%', exact: true }).click()
  await expect(zoom).toHaveText('150%')
  await zoom.click()
  await page.getByRole('button', { name: 'Reset zoom' }).click()
  await expect(zoom).toHaveText('100%')
  await expect(page.locator('#location')).toHaveText('Section 1 of 2')
})

test('accepts a two-finger pinch over the reader', async ({ page }) => {
  await open(page)
  await page.evaluate(() => {
    const surface = document.querySelector('#reader')!
    const fingers = (left: number, right: number) => [
      new Touch({ identifier: 1, target: surface, clientX: left, clientY: 250 }),
      new Touch({ identifier: 2, target: surface, clientX: right, clientY: 250 }),
    ]
    surface.dispatchEvent(new TouchEvent('touchstart', { touches: fingers(200, 300), cancelable: true }))
    surface.dispatchEvent(new TouchEvent('touchmove', { touches: fingers(175, 325), cancelable: true }))
    surface.dispatchEvent(new TouchEvent('touchend', { touches: [] }))
  })
  await expect(page.getByRole('button', { name: 'Zoom options' })).toHaveText('150%')
})

test('preserves publisher page labels and magnifies fixed pages', async ({ page }) => {
  await open(page, { fixed: true, pageList: true })
  await expect(page.locator('#location')).toHaveText('Page iv')
  await expect(page.getByRole('button', { name: 'Zoom options' })).toHaveText('Fit page')
  await page.getByRole('button', { name: 'Zoom options' }).click()
  await page.getByRole('button', { name: 'Fit width', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Zoom options' })).toHaveText('Fit width')
  await page.getByRole('button', { name: 'Zoom options' }).click()
  await page.getByRole('button', { name: '150%', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Zoom options' })).toHaveText('150%')
  await expect.poll(() => page.evaluate(() => {
    const view = document.querySelector('foliate-view') as unknown as {
      renderer: { getContents(): { doc: Document }[] }
    }
    return view.renderer.getContents()[0].doc.defaultView?.frameElement?.getBoundingClientRect().width
  })).toBe(900)
  await page.getByRole('button', { name: 'Next' }).click()
  await expect(page.locator('#location')).toHaveText('Page 7')
})

test('shows the transition between publisher pages in continuous reflow', async ({ page }) => {
  await open(page, { pageList: true })
  await expect(page.locator('#location')).toHaveText('Page iv')
  await expect.poll(async () => (await surface(page, 'read')).markers)
    .toContain('End of page iv · Start of page 7')
  await surface(page, 'forward')
  await expect(page.locator('#location')).toHaveText('Page 7')
})

test('shows a download chooser offline, on the welcome screen and from Help', async ({ page, context }) => {
  await page.goto('/')
  await expect(page.locator('#offline')).toHaveText('Ready to read offline.')
  await context.setOffline(true)
  await page.getByRole('button', { name: 'Download desktop app' }).click()
  const dialog = page.getByRole('dialog', { name: 'Download desktop app' })
  await expect(dialog.getByRole('listitem')).toHaveCount(6)
  if (process.env.PAGEGLADE_TEST_DOWNLOAD) {
    await expect(dialog.getByRole('link', { name: 'Windows installer' }))
      .toHaveAttribute('href', process.env.PAGEGLADE_TEST_DOWNLOAD)
    await expect(dialog.getByRole('link')).toHaveCount(1)
  } else {
    await expect(dialog).toContainText('Desktop installers are coming soon.')
    await expect(dialog.getByRole('link')).toHaveCount(0)
  }
  await dialog.getByRole('button', { name: 'Close' }).click()
  await page.getByRole('button', { name: 'Help', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Download desktop app' }).click()
  await expect(dialog).toBeVisible()
})
