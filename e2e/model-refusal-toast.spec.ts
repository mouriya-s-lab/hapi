/*
 * End-to-end coverage for issue #47. Drives real Chromium against a Vite-served
 * fixture that injects a Claude `system/model_refusal_fallback` event into the
 * production SessionChat and verifies the warning toast behavior.
 */

import { test, expect, Page } from '@playwright/test'

async function gotoFixture(page: Page, params = ''): Promise<void> {
    await page.goto(`/e2e-fixtures/model-refusal-toast-fixture.html${params}`)
    await expect(page.getByTestId('model-refusal-toast-host')).toBeVisible()
}

async function warningToast(page: Page) {
    const toast = page.locator('[data-toast-variant="warning"]')
    await expect(toast).toBeVisible()
    return toast
}

test.describe('model refusal fallback toast', () => {
    test('shows warning toast with model-switch text and light warning color', async ({ page }) => {
        await gotoFixture(page)

        const toast = await warningToast(page)
        await expect(toast).toContainText('Model automatically switched')
        await expect(toast).toContainText('claude-fable-5[1m]')
        await expect(toast).toContainText('Switched to Opus 4.8')
        await expect(page.getByText('Model automatically switched from claude-fable-5[1m]')).toBeVisible()

        const color = await toast.evaluate((element) => getComputedStyle(element).color)
        expect(color).toBe('rgb(180, 83, 9)')
    })

    test('uses dark-theme warning color', async ({ page }) => {
        await gotoFixture(page, '?theme=dark')

        const toast = await warningToast(page)
        const color = await toast.evaluate((element) => getComputedStyle(element).color)
        expect(color).toBe('rgb(251, 191, 36)')
    })

    test('can be dismissed manually', async ({ page }) => {
        await gotoFixture(page)

        await warningToast(page)
        await page.getByRole('button', { name: 'Dismiss' }).click()
        await expect(page.locator('[data-toast-variant="warning"]')).toHaveCount(0)
    })

    test('auto-dismisses after the five-second warning duration', async ({ page }) => {
        await gotoFixture(page)

        await warningToast(page)
        await expect(page.locator('[data-toast-variant="warning"]')).toHaveCount(0, { timeout: 6_500 })
    })
})
