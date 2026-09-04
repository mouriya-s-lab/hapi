/*
 * Regression coverage for "clicking a session makes the left list jump to a weird
 * scroll position" (issue #31 / #277). One coordinator owns both mechanisms:
 *
 * 1. Reorder jump — opening a session resumes it → it goes active and its
 *    directory group is re-sorted to the top (SessionList sorts active-first).
 * 2. Restoration jump — TanStack Router rewrites the persistent sidebar's
 *    scrollTop from the target route's stale bucket on every navigation.
 *
 * The fixture passes the REAL SessionList the same required `scrollStability`
 * binding as router.tsx. SessionList itself reports its internal scroll node and
 * captures the selected row before invoking navigation. Disabled modes prove
 * each failure still reproduces without the corresponding protection.
 */

import { test, expect, type Page } from '@playwright/test'

type Measure = { before: number; after: number; scrollBefore: number; scrollAfter: number }

async function clickDeltaSessionAndMeasure(
    page: Page,
    query: string,
    expectActivation: boolean,
): Promise<Measure> {
    await page.goto(`/e2e-fixtures/session-scroll-fixture.html?sel=delta-0${query}`)
    const container = page.getByTestId('session-scroll-container')
    await expect(container).toBeVisible()
    await expect(container).toHaveAttribute('data-preserve-ready', 'true')

    await container.evaluate((element) => {
        element.scrollTop = element.scrollHeight
    })

    const pick = await container.evaluate((element) => {
        const containerRect = element.getBoundingClientRect()
        const visibleRows = [...element.querySelectorAll<HTMLButtonElement>('button')].filter((button) => {
            const rowRect = button.getBoundingClientRect()
            return rowRect.top > containerRect.top + 10
                && rowRect.bottom < containerRect.bottom - 10
                && /delta session [1-5]/.test(button.textContent ?? '')
        })
        const target = visibleRows[Math.floor(visibleRows.length / 2)]
        const sessionId = target?.dataset.sessionId
        if (!target || !sessionId) return null
        target.setAttribute('data-pick', '1')
        return {
            sessionId,
            top: Math.round(target.getBoundingClientRect().top),
        }
    })
    if (!pick) throw new Error('no delta session visible to click')

    const scrollBefore = await container.evaluate((element) => element.scrollTop)
    await page.locator('[data-pick="1"]').click()
    await expect(page.getByTestId('selected-readout'))
        .toHaveAttribute('data-selected-session-id', pick.sessionId)
    if (expectActivation) {
        await expect(container).toHaveAttribute('data-active-session-id', pick.sessionId)
    }
    await page.evaluate(() => new Promise<void>((resolve) => {
        let framesRemaining = 4
        const waitForFrame = () => {
            framesRemaining -= 1
            if (framesRemaining === 0) {
                resolve()
            } else {
                requestAnimationFrame(waitForFrame)
            }
        }
        requestAnimationFrame(waitForFrame)
    }))

    const result = await page.evaluate(() => {
        const element = document.querySelector<HTMLElement>('[data-testid="session-scroll-container"]')
        const picked = document.querySelector<HTMLElement>('[data-pick="1"]')
        if (!element || !picked) return null
        return {
            scrollAfter: element.scrollTop,
            pickScreenY: Math.round(picked.getBoundingClientRect().top),
        }
    })
    if (!result) throw new Error('clicked row or scroll container disappeared')
    return {
        before: pick.top,
        after: result.pickScreenY,
        scrollBefore,
        scrollAfter: result.scrollAfter,
    }
}

test.describe('session list — activation reorder (anchor guard)', () => {
    for (const scenario of [
        { name: 'after the restoration window', query: '' },
        { name: 'inside the restoration window', query: '&fastactivate' },
    ]) {
        test(`without the anchor, activation ${scenario.name} lurches the list`, async ({ page }) => {
            const m = await clickDeltaSessionAndMeasure(page, `${scenario.query}&noanchor`, true)
            expect(Math.abs(m.after - m.before)).toBeGreaterThan(60)
        })

        test(`with the anchor, activation ${scenario.name} keeps the clicked row put`, async ({ page }) => {
            const m = await clickDeltaSessionAndMeasure(page, scenario.query, true)
            expect(Math.abs(m.after - m.before)).toBeLessThan(8)
        })
    }
})

test.describe('session list — router scroll restoration (preserve guard)', () => {
    test('without the guard, navigation rewrites the sidebar scroll (bug reproduces)', async ({ page }) => {
        const m = await clickDeltaSessionAndMeasure(page, '&nopreserve&noactivate&noanchor', false)
        // The simulated per-route restoration write sticks: the list snaps to 0.
        expect(m.scrollBefore).toBeGreaterThan(200)
        expect(m.scrollAfter).toBeLessThan(10)
    })

    test('with the guard, the sidebar keeps the user scroll position', async ({ page }) => {
        const m = await clickDeltaSessionAndMeasure(page, '&noactivate', false)
        expect(m.scrollBefore).toBeGreaterThan(200)
        expect(Math.abs(m.scrollAfter - m.scrollBefore)).toBeLessThan(5)
    })

    test('user wheel input cancels a pending restoration re-assert', async ({ page }) => {
        await page.addInitScript(() => {
            const frameDelayMs = 300
            window.requestAnimationFrame = (callback) => window.setTimeout(
                () => callback(performance.now()),
                frameDelayMs,
            )
            window.cancelAnimationFrame = (handle) => window.clearTimeout(handle)
        })
        await page.goto('/e2e-fixtures/session-scroll-fixture.html?sel=delta-0&noactivate')
        const container = page.getByTestId('session-scroll-container')
        await expect(container).toBeVisible()
        await expect(container).toHaveAttribute('data-preserve-ready', 'true')
        await page.evaluate(() => new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }))

        const before = await container.evaluate((element) => {
            element.scrollTop = element.scrollHeight
            const containerRect = element.getBoundingClientRect()
            const target = [...element.querySelectorAll<HTMLButtonElement>('button[data-session-id]')]
                .find((button) => {
                    const rowRect = button.getBoundingClientRect()
                    return rowRect.top > containerRect.top + 10
                        && rowRect.bottom < containerRect.bottom - 10
                })
            if (!target) return null
            target.setAttribute('data-wheel-pick', '1')
            return element.scrollTop
        })
        if (before === null) throw new Error('no session visible for wheel-input scenario')

        const target = page.locator('[data-wheel-pick="1"]')
        await target.dispatchEvent('mousedown', { button: 0, clientX: 120, clientY: 240 })
        await target.dispatchEvent('mouseup', { button: 0, clientX: 120, clientY: 240 })
        await expect(container).toHaveAttribute('data-restoration-written', 'true')
        const afterRestoration = await container.evaluate((element) => element.scrollTop)
        await container.hover()
        await page.mouse.wheel(0, 160)
        await expect.poll(() => container.evaluate((element) => element.scrollTop))
            .toBeGreaterThan(afterRestoration + 100)
        const afterInput = await container.evaluate((element) => element.scrollTop)

        await page.evaluate(() => new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        }))
        const settled = await container.evaluate((element) => element.scrollTop)
        expect(Math.abs(settled - afterInput)).toBeLessThan(5)
        expect(Math.abs(settled - before)).toBeGreaterThan(100)
    })
})
