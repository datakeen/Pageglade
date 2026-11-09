// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FixedZoom } from './zoom'

export type Preferences = {
  theme: 'system' | 'light' | 'sepia' | 'dark'
  layout: 'single' | 'spread' | 'scroll'
  font: 'publisher' | 'serif' | 'sans' | 'nastaliq'
  size: number
  fixedZoom: FixedZoom
  markers: boolean
  spacing: 'publisher' | 'normal' | 'wide'
  margin: 'normal' | 'narrow' | 'wide'
  alignment: 'publisher' | 'start' | 'justify'
}

export const defaults: Preferences = {
  theme: 'system', layout: 'scroll', font: 'publisher', size: 100,
  fixedZoom: 'fit-page', markers: true,
  spacing: 'publisher', margin: 'normal', alignment: 'publisher',
}

export function parsePreferences(value: unknown): Preferences | null {
  if (!value || typeof value !== 'object') return null
  const preferences = { fixedZoom: defaults.fixedZoom, markers: defaults.markers, ...value } as Preferences
  if (!['system', 'light', 'sepia', 'dark'].includes(preferences.theme)
    || !['single', 'spread', 'scroll'].includes(preferences.layout)
    || !['publisher', 'serif', 'sans', 'nastaliq'].includes(preferences.font)
    || !Number.isInteger(preferences.size) || preferences.size < 75 || preferences.size > 200
    || (preferences.fixedZoom !== 'fit-page' && preferences.fixedZoom !== 'fit-width'
      && (!Number.isInteger(preferences.fixedZoom) || preferences.fixedZoom < 50 || preferences.fixedZoom > 300))
    || typeof preferences.markers !== 'boolean'
    || !['publisher', 'normal', 'wide'].includes(preferences.spacing)
    || !['normal', 'narrow', 'wide'].includes(preferences.margin)
    || !['publisher', 'start', 'justify'].includes(preferences.alignment)) return null
  return Object.fromEntries(Object.keys(defaults).map(key =>
    [key, preferences[key as keyof Preferences]])) as Preferences
}

let database: Promise<IDBDatabase> | undefined

function getDatabase() {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('pageglade', 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore('books')
      request.result.createObjectStore('state')
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Close other Pageglade windows to use saved reading data.'))
  })
  return database
}

export async function get<T>(store: 'state' | 'books', key: string): Promise<T | undefined> {
  const db = await getDatabase()
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
  })
}

export async function save(store: 'state' | 'books', values: Record<string, unknown>) {
  const db = await getDatabase()
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(store, 'readwrite', { durability: 'strict' })
    const table = transaction.objectStore(store)
    for (const [key, value] of Object.entries(values)) table.put(value, key)
    transaction.oncomplete = () => resolve()
    transaction.onabort = () => reject(transaction.error)
    transaction.onerror = () => reject(transaction.error)
  })
}
