/*
 * End-to-end coverage for the session-list "ready" blue dot and the
 * hide-archived toggle (issue #4).
 *
 * Drives a real Chromium against web/e2e-fixtures/session-list-fixture.html
 * (vite dev), which mounts the production SessionList with crafted sessions and
 * a real hide-archived toggle wired through the production hook + filter helper.
 * Each test gets a fresh browser context, so localStorage starts clean.
 */

import { test, expect, Page } from '@playwright/test'

async function gotoFixture(page: Page): Promise<void> {
    await page.goto('/e2e-fixtures/session-list-fixture.html')
    await expect(page.getByTestId('session-list-host')).toBeVisible()
}

test.describe('session list — ready blue dot', () => {
    test('shows a ready dot for the idle active session and none for the thinking one', async ({ page }) => {
        await gotoFixture(page)

        // Exactly one ready dot (the active, non-thinking session).
        await expect(page.locator('[data-attention="ready"]')).toHaveCount(1)
        // No other attention dots: the thinking session shows a spinner, the
        // archived (inactive, seen) session shows nothing.
        await expect(page.locator('[data-attention]')).toHaveCount(1)
    })
})

test.describe('session list — hide archived toggle', () => {
    test('hides archived sessions when toggled and persists across reload', async ({ page }) => {
        await gotoFixture(page)

        // Archived session is visible by default.
        await expect(page.getByText('Archived Session')).toBeVisible()
        await expect(page.getByText('Ready Session')).toBeVisible()

        // Toggle hide-archived on → archived row disappears, others remain.
        await page.getByTestId('hide-archived-toggle').click()
        await expect(page.getByText('Archived Session')).toHaveCount(0)
        await expect(page.getByText('Ready Session')).toBeVisible()

        // Preference persists across a full reload.
        await page.reload()
        await expect(page.getByTestId('session-list-host')).toBeVisible()
        await expect(page.getByText('Archived Session')).toHaveCount(0)
        await expect(page.getByText('Ready Session')).toBeVisible()
    })
})
