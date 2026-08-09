/*
 * Regression coverage for "clicking a session makes the left list jump to a weird
 * scroll position" (issue #31 / #277). Two independent mechanisms, two guards:
 *
 * 1. Reorder jump — opening a session resumes it → it goes active and its
 *    directory group is re-sorted to the top (SessionList sorts active-first),
 *    which lurches the scroll position. useAnchoredSessionScroll pins the
 *    clicked row's screen position across that reorder.
 * 2. Restoration jump — TanStack Router's per-route scroll restoration rewrites
 *    the persistent sidebar's scrollTop from the target route's stale bucket on
 *    every navigation. usePreserveSidebarScroll re-asserts the user's position.
 *
 * The fixture wires the REAL SessionList through its
 * `onScrollContainerChange` seam into both real hooks, exactly like router.tsx.
 * Each guard has a disabled-variant test asserting the bug still reproduces
 * without it. Disconnecting the seam therefore makes the fixed-path tests fail
 * instead of silently dropping the protection.
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
    test('without the anchor, clicking a session lurches the list (bug reproduces)', async ({ page }) => {
        const m = await clickDeltaSessionAndMeasure(page, '&noanchor', true)
        // The clicked row is yanked far from where it was clicked.
        expect(Math.abs(m.after - m.before)).toBeGreaterThan(60)
    })

    test('with the anchor, the clicked session stays put', async ({ page }) => {
        const m = await clickDeltaSessionAndMeasure(page, '', true)
        // The clicked row holds its screen position despite the reorder.
        expect(Math.abs(m.after - m.before)).toBeLessThan(8)
    })
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
})
