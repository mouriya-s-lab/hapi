/*
 * End-to-end coverage for the Mermaid diagram pan/zoom viewer. Drives a real
 * Chromium against `web/e2e-fixtures/mermaid-fixture.html` (vite dev), which
 * mounts the production MermaidDiagram. A real Mermaid SVG is rendered; clicking
 * it opens the fork's MermaidZoomViewer overlay (react-zoom-pan-pinch) with
 * zoom in/out/reset controls, wheel zoom, and drag-to-pan.
 *
 * Pinch (two-finger) is provided by react-zoom-pan-pinch's touch handling and is
 * not multi-touch-scriptable via Playwright; these tests exercise the same
 * transform pipeline through buttons, wheel, and drag.
 */

import { test, expect, Page } from '@playwright/test'

type Transform = { scale: number; x: number; y: number }

async function readTransform(page: Page): Promise<Transform> {
    return await page.locator('.react-transform-component').first().evaluate((el) => {
        const m = new DOMMatrixReadOnly(getComputedStyle(el as HTMLElement).transform)
        return { scale: m.a, x: m.e, y: m.f }
    })
}

// react-zoom-pan-pinch animates button zooms, so a single post-click read can
// catch a mid-animation value. Poll until the scale stops changing.
async function settledScale(page: Page): Promise<number> {
    let prev = Number.NaN
    for (let i = 0; i < 25; i++) {
        const s = (await readTransform(page)).scale
        if (Math.abs(s - prev) < 0.001) return s
        prev = s
        await page.waitForTimeout(120)
    }
    return prev
}

async function openViewer(page: Page): Promise<void> {
    await page.goto('/e2e-fixtures/mermaid-fixture.html')
    // Inline diagram renders the real Mermaid SVG.
    await expect(page.locator('[data-mermaid-diagram][data-rendered="true"]')).toBeVisible()
    // Click to open the zoomable overlay.
    await page.locator('[data-mermaid-zoom-trigger]').click()
    await expect(page.locator('[data-mermaid-zoom-overlay]')).toBeVisible()
    await expect(page.locator('[data-mermaid-zoom-controls]')).toBeVisible()
    await expect(page.locator('[data-mermaid-zoom-canvas]')).toBeVisible()
}

test.describe('Mermaid diagram pan/zoom viewer', () => {
    test('zoom-in / zoom-out / reset buttons change and restore the scale', async ({ page }) => {
        await openViewer(page)
        const initial = await settledScale(page)

        await page.getByRole('button', { name: 'Zoom in' }).click()
        const zoomedIn = await settledScale(page)
        expect(zoomedIn).toBeGreaterThan(initial)

        await page.getByRole('button', { name: 'Zoom out' }).click()
        const zoomedOut = await settledScale(page)
        expect(zoomedOut).toBeLessThan(zoomedIn)

        await page.getByRole('button', { name: 'Zoom in' }).click()
        await settledScale(page)
        await page.getByRole('button', { name: 'Reset zoom' }).click()
        const afterReset = await settledScale(page)
        expect(Math.abs(afterReset - initial)).toBeLessThan(0.05)
    })

    test('mouse wheel zooms the diagram', async ({ page }) => {
        await openViewer(page)
        const initial = await readTransform(page)

        const box = await page.locator('[data-mermaid-zoom-canvas]').boundingBox()
        if (!box) throw new Error('no canvas box')
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.wheel(0, -400) // wheel up -> zoom in

        await expect.poll(async () => (await readTransform(page)).scale).toBeGreaterThan(initial.scale)
    })

    test('dragging pans the diagram', async ({ page }) => {
        await openViewer(page)
        const initial = await readTransform(page)

        const overlay = await page.locator('[data-mermaid-zoom-overlay]').boundingBox()
        if (!overlay) throw new Error('no overlay box')
        const cx = overlay.x + overlay.width / 2
        const cy = overlay.y + overlay.height / 2
        await page.mouse.move(cx, cy)
        await page.mouse.down()
        await page.mouse.move(cx + 140, cy + 90, { steps: 10 })
        await page.mouse.up()

        await expect.poll(async () => {
            const t = await readTransform(page)
            return Math.abs(t.x - initial.x) + Math.abs(t.y - initial.y)
        }).toBeGreaterThan(20)
    })

    test('two-finger pinch-out zooms in (touch)', async ({ page, browserName }) => {
        test.skip(browserName !== 'chromium', 'CDP touch dispatch is chromium-only')
        await openViewer(page)
        const initial = await settledScale(page)

        const box = await page.locator('[data-mermaid-zoom-canvas]').boundingBox()
        if (!box) throw new Error('no canvas box')
        const cx = box.x + box.width / 2
        const cy = box.y + box.height / 2

        const cdp = await page.context().newCDPSession(page)
        await cdp.send('Input.dispatchTouchEvent', {
            type: 'touchStart',
            touchPoints: [{ x: cx - 20, y: cy }, { x: cx + 20, y: cy }],
        })
        for (let i = 1; i <= 6; i++) {
            const d = 20 + i * 32
            await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [{ x: cx - d, y: cy }, { x: cx + d, y: cy }],
            })
            await page.waitForTimeout(40)
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })

        await expect.poll(async () => (await readTransform(page)).scale).toBeGreaterThan(initial + 0.05)
    })

    test('overlay closes via the close button and Escape', async ({ page }) => {
        await openViewer(page)
        await page.locator('[data-mermaid-zoom-close]').click()
        await expect(page.locator('[data-mermaid-zoom-overlay]')).toHaveCount(0)

        await page.locator('[data-mermaid-zoom-trigger]').click()
        await expect(page.locator('[data-mermaid-zoom-overlay]')).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.locator('[data-mermaid-zoom-overlay]')).toHaveCount(0)
    })
})
