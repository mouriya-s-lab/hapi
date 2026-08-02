import { expect, test } from '@playwright/test'

test('expanded reasoning keeps its collapse control visible while scrolling', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/e2e-fixtures/reasoning-sticky-fixture.html', { waitUntil: 'commit' })

    const viewport = page.getByTestId('scroll-viewport')
    const button = page.getByRole('button', { name: 'Reasoning' })
    await button.click()
    await expect(page.getByText('click to collapse')).toBeVisible()

    await viewport.evaluate((element) => { element.scrollTop = 1200 })

    const viewportBox = await viewport.boundingBox()
    const buttonBox = await button.boundingBox()
    expect(buttonBox?.y).toBe((viewportBox?.y ?? 0) + 24)
    await button.click()
    await expect(page.getByText('click to collapse')).toBeHidden()
    await expect(page.getByTestId('long-reasoning').locator('../..')).toHaveClass(/max-h-0/)
})
