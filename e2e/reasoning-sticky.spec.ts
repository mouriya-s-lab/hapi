import { expect, test, type Locator } from '@playwright/test'

async function lastLineIsUnclipped(host: Locator): Promise<boolean> {
    return host.evaluate((element) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()
        while (node && !node.textContent?.includes('line 40')) node = walker.nextNode()
        if (!node) throw new Error('Last source line is missing')
        const start = node.textContent!.indexOf('line 40')
        const range = document.createRange()
        range.setStart(node, start)
        range.setEnd(node, start + 'line 40'.length)
        const line = range.getBoundingClientRect()
        if (line.height === 0) return false
        for (let ancestor = node.parentElement; ancestor && ancestor !== element.parentElement; ancestor = ancestor.parentElement) {
            if (!['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(ancestor).overflowY)) continue
            const bounds = ancestor.getBoundingClientRect()
            if (line.top < bounds.top || line.bottom > bounds.bottom + 1) return false
        }
        return true
    })
}

test('production reasoning keeps its collapse control reachable through outer and nested scrolling', async ({ page }) => {
    test.setTimeout(120_000)
    await page.goto('/e2e-fixtures/reasoning-sticky-fixture.html', { waitUntil: 'commit' })
    const viewport = page.getByTestId('scroll-viewport')
    const button = page.getByRole('button', { name: /Reasoning/ })
    const nested = page.locator('[data-hapi-nested-scroll]')
    await button.click()
    await expect(page.getByText('click to collapse')).toBeVisible()
    await expect.poll(() => nested.evaluate((element) => element.clientHeight)).toBeGreaterThan(0)

    await viewport.evaluate((element) => {
        const control = element.querySelector('button')
        if (!control) throw new Error('Reasoning control missing')
        element.scrollTop += control.getBoundingClientRect().top - element.getBoundingClientRect().top + 100
    })
    await expect(button).toBeInViewport({ ratio: 1 })
    await nested.evaluate((element) => { element.scrollTop = element.scrollHeight })
    await expect(page.getByText('Reasoning paragraph 80.', { exact: true })).toBeInViewport()
    await expect(button).toBeInViewport({ ratio: 1 })
    // A real click must succeed without Playwright scrolling the control back into view.
    const box = await button.boundingBox()
    if (!box) throw new Error('Reasoning control has no visible bounds')
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(page.getByText('click to collapse')).toBeHidden()
    await expect.poll(() => nested.evaluate((element) => element.parentElement!.getBoundingClientRect().height)).toBe(0)
})

for (const surface of ['code', 'user'] as const) {
    test(`${surface} expansion reveals the clipped final source line and collapses it again`, async ({ page }) => {
        await page.goto(`/e2e-fixtures/reasoning-sticky-fixture.html?expansion=${surface}`)
        const host = page.getByTestId('expansion-host')
        await expect(host.getByRole('button', { name: 'Show all (40 lines)' })).toBeVisible()
        await expect.poll(() => lastLineIsUnclipped(host)).toBe(false)
        await host.getByRole('button', { name: 'Show all (40 lines)' }).click()
        await expect.poll(() => lastLineIsUnclipped(host)).toBe(true)
        await (surface === 'code'
            ? host.getByTitle('Collapse', { exact: true })
            : host.getByRole('button', { name: 'Collapse', exact: true })).click()
        await expect.poll(() => lastLineIsUnclipped(host)).toBe(false)
        if (surface === 'user') {
            await expect(page.getByTestId('short-content')).toHaveText('short')
            await expect(page.getByTestId('short-content').getByRole('button')).toHaveCount(0)
        }
    })
}
