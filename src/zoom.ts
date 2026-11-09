// SPDX-License-Identifier: AGPL-3.0-or-later
export type ZoomPoint = { x: number; y: number }
export type FixedZoom = number | 'fit-page' | 'fit-width'

export function bindZoomGestures(
  surface: HTMLElement | Document,
  apply: (change: number, point: ZoomPoint, base?: number) => void,
  current: () => number | undefined,
  frame?: Element | null,
) {
  const point = (x: number, y: number) => {
    const bounds = frame?.getBoundingClientRect()
    const scale = frame instanceof HTMLElement ? (bounds?.width ?? 0) / frame.offsetWidth || 1 : 1
    return { x: (bounds?.left ?? 0) + x * scale, y: (bounds?.top ?? 0) + y * scale }
  }
  let accumulated = 0
  let lastWheel = 0
  const target = surface as EventTarget
  target.addEventListener('wheel', raw => {
    const event = raw as WheelEvent
    if ((!event.ctrlKey && !event.metaKey) || !event.cancelable || !event.deltaY || current() === undefined) return
    event.preventDefault()
    const now = performance.now()
    if (now - lastWheel > 180) accumulated = 0
    lastWheel = now
    accumulated += -event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 120 : 1)
    if (Math.abs(accumulated) < 36) return
    apply(Math.sign(accumulated) * (event.shiftKey ? 5 : 10), point(event.clientX, event.clientY))
    accumulated = 0
  }, { passive: false })

  let pinch: { distance: number; base: number } | undefined
  const touchDistance = (touches: TouchList) => Math.hypot(
    touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY,
  )
  target.addEventListener('touchstart', raw => {
    const { touches } = raw as TouchEvent
    const base = current()
    if (touches.length !== 2 || base === undefined) return
    pinch = { distance: touchDistance(touches), base }
  }, { passive: true })
  target.addEventListener('touchmove', raw => {
    const event = raw as TouchEvent
    const { touches } = event
    if (!pinch || touches.length !== 2 || !event.cancelable || pinch.distance < 12) return
    const factor = touchDistance(touches) / pinch.distance
    if (Math.abs(factor - 1) < .04) return
    event.preventDefault()
    const midpoint = point((touches[0].clientX + touches[1].clientX) / 2, (touches[0].clientY + touches[1].clientY) / 2)
    apply(pinch.base * (factor - 1), midpoint, pinch.base)
  }, { passive: false })
  for (const name of ['touchend', 'touchcancel']) {
    target.addEventListener(name, () => { pinch = undefined }, { passive: true })
  }
}
