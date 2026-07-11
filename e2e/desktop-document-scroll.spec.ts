import { devices, expect, test } from '@playwright/test'

async function installOverflowProbe(page: import('@playwright/test').Page) {
    await page.goto('/e2e-fixtures/document-scroll-fixture.html')
}

test('desktop keeps scrolling inside the app container, not the document', async ({ page }) => {
    await installOverflowProbe(page)

    const metrics = await page.evaluate(() => {
        const appScroller = document.querySelector<HTMLElement>('[data-app-scroller]')
        if (!appScroller) throw new Error('Missing app scroll probe')
        return {
            htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
            bodyOverflowY: getComputedStyle(document.body).overflowY,
            appOverflowY: getComputedStyle(appScroller).overflowY,
            appCanScroll: appScroller.scrollHeight > appScroller.clientHeight,
        }
    })

    expect(metrics).toEqual({
        htmlOverflowY: 'hidden',
        bodyOverflowY: 'hidden',
        appOverflowY: 'auto',
        appCanScroll: true,
    })
})

test('touch-first mobile keeps document scrolling available', async ({ browser }) => {
    const context = await browser.newContext(devices['Pixel 7'])
    const page = await context.newPage()
    await installOverflowProbe(page)

    const metrics = await page.evaluate(() => ({
        coarsePointer: matchMedia('(pointer: coarse)').matches,
        hover: matchMedia('(hover: hover)').matches,
        htmlOverflowY: getComputedStyle(document.documentElement).overflowY,
        bodyOverflowY: getComputedStyle(document.body).overflowY,
    }))

    expect(metrics).toEqual({
        coarsePointer: true,
        hover: false,
        htmlOverflowY: 'auto',
        bodyOverflowY: 'auto',
    })
    await context.close()
})
