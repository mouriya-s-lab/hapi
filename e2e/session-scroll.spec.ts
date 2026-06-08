/*
 * Regression coverage for "clicking a session makes the left list jump to a weird
 * scroll position". Opening a session resumes it → it goes active and its directory
 * group is re-sorted to the top of the list (SessionList sorts active-first), which
 * lurches the scroll position. useAnchoredSessionScroll pins the clicked row's screen
 * position across that reorder. The fixture wires the real hook exactly like router.tsx.
 *
 * `?noanchor` disables the fix and asserts the bug still reproduces, so the with-fix
 * assertion can't silently pass on a changed layout.
 */

import { test, expect, Page } from '@playwright/test'

async function clickDeltaSessionAndMeasure(page: Page, query: string): Promise<{ before: number; after: number; scrollBefore: number; scrollAfter: number }> {
    await page.goto(`/e2e-fixtures/session-scroll-fixture.html?sel=delta-0${query}`)
    const container = page.getByTestId('session-scroll-container')
    await expect(container).toBeVisible()

    // Scroll to the delta group region (delta starts inactive/low in the list).
    await container.evaluate((el) => { el.scrollTop = el.scrollHeight })
    await page.waitForTimeout(150)

    const pick = await container.evaluate((el) => {
        const cRect = el.getBoundingClientRect()
        const btns = [...el.querySelectorAll('button')].filter((b) => {
            const r = b.getBoundingClientRect()
            return r.top > cRect.top + 10 && r.bottom < cRect.bottom - 10 && /delta session [1-7]/.test(b.textContent || '')
        })
        const target = btns[Math.floor(btns.length / 2)]
        if (!target) return null
        target.setAttribute('data-pick', '1')
        return Math.round(target.getBoundingClientRect().top)
    })
    if (pick === null) throw new Error('no delta session visible to click')

    const scrollBefore = await container.evaluate((el) => el.scrollTop)
    await page.locator('[data-pick="1"]').click()
    await page.waitForTimeout(450) // let the async activation reorder land

    const result = await page.evaluate(() => {
        const el = document.querySelector('[data-testid="session-scroll-container"]') as HTMLElement
        const picked = document.querySelector('[data-pick="1"]') as HTMLElement | null
        return {
            scrollAfter: el.scrollTop,
            pickScreenY: picked ? Math.round(picked.getBoundingClientRect().top) : null,
        }
    })
    if (result.pickScreenY === null) throw new Error('clicked row disappeared')
    return { before: pick, after: result.pickScreenY, scrollBefore, scrollAfter: result.scrollAfter }
}

test('without the fix, clicking a session lurches the list (bug reproduces)', async ({ page }) => {
    const m = await clickDeltaSessionAndMeasure(page, '&noanchor')
    // The clicked row is yanked far from where it was clicked.
    expect(Math.abs(m.after - m.before)).toBeGreaterThan(60)
})

test('with the fix, the clicked session stays put (no scroll jump)', async ({ page }) => {
    const m = await clickDeltaSessionAndMeasure(page, '')
    // The clicked row holds its screen position despite the reorder.
    expect(Math.abs(m.after - m.before)).toBeLessThan(8)
})
