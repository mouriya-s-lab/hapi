/*
 * End-to-end coverage for the conversation-header "Session ID" menu item
 * (issue #20). Drives a real Chromium against
 * `web/e2e-fixtures/session-id-fixture.html` (vite dev), which mounts the
 * production SessionHeader — the bar that renders the 3-dot SessionActionMenu
 * and the fork's SessionIdDialog — for a synthetic session. No hub / auth.
 *
 * The session flavor + id are chosen with `?flavor=` / `?sid=` so each test
 * exercises a different resume-id field, the clipboard copy, or the empty state.
 */

import { test, expect, Page } from '@playwright/test'

async function gotoFixture(page: Page, params = ''): Promise<void> {
    await page.goto(`/e2e-fixtures/session-id-fixture.html${params}`)
    await expect(page.getByTestId('session-id-host')).toBeVisible()
}

async function openSessionIdDialog(page: Page): Promise<void> {
    await page.getByTitle('More actions').click()
    await page.getByTestId('session-action-session-id').click()
}

test.describe('conversation header — Session ID', () => {
    test('menu item opens a dialog showing the resume-able session id (omp)', async ({ page }) => {
        await gotoFixture(page)
        await openSessionIdDialog(page)

        const input = page.getByTestId('session-id-input')
        await expect(input).toBeVisible()
        await expect(input).toHaveValue('omp-thread-e2e')
        await expect(input).toHaveAttribute('readonly', '')
    })

    test('copy button writes the session id to the clipboard', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write'])
        await gotoFixture(page, '?flavor=opencode&sid=oc-thread-7')
        await openSessionIdDialog(page)

        await expect(page.getByTestId('session-id-input')).toHaveValue('oc-thread-7')
        await page.getByTestId('session-id-copy').click()

        const clip = await page.evaluate(() => navigator.clipboard.readText())
        expect(clip).toBe('oc-thread-7')
    })

    test('shows an empty state when there is no resume-able id', async ({ page }) => {
        await gotoFixture(page, '?flavor=omp&sid=')
        await openSessionIdDialog(page)

        await expect(page.getByTestId('session-id-empty')).toBeVisible()
        await expect(page.getByTestId('session-id-input')).toHaveCount(0)
    })
})
