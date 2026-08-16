/*
 * End-to-end coverage for the file-viewer markdown preview + word-wrap
 * toggle + mermaid zoom (issue #3 / PR for issue #3).
 *
 * These specs drive a real Chromium against
 * `web/e2e-fixtures/file-viewer-fixture.html` (vite dev), which mounts the
 * production FilePage behind a minimal in-memory router + stubbed api. The
 * file under view is chosen with `?file=` so each test exercises either the
 * markdown (.md) path or the plain-text (word-wrap) path. Each test gets a
 * fresh browser context, so localStorage preferences start clean.
 *
 * Real-browser coverage matters here because mermaid renders an <svg> via a
 * dynamic import and the zoom overlay is a portal — neither is meaningfully
 * exercised under jsdom.
 */

import { test, expect, Page } from '@playwright/test'

async function gotoFile(page: Page, file: string): Promise<void> {
    await page.goto(`/e2e-fixtures/file-viewer-fixture.html?file=${encodeURIComponent(file)}`)
    await expect(page.getByTestId('file-viewer-host')).toBeVisible()
}

test.describe('file viewer — markdown preview', () => {
    test('wraps code without line numbers on mobile while preserving desktop code layout', async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 })
        await gotoFile(page, 'README.md')

        const codeBlock = page.locator('.aui-md-codeblock').first()
        const gutter = codeBlock.locator('.aui-md-codeblock-gutter')
        const content = codeBlock.locator('.aui-md-codeblock-content')

        await expect(gutter).toBeHidden()
        await expect(content).toHaveCSS('white-space', 'pre-wrap')
        await expect.poll(() => codeBlock.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)

        await page.setViewportSize({ width: 1280, height: 800 })
        await expect(gutter).toBeVisible()
        await expect(content).toHaveCSS('white-space', 'pre')
        await expect.poll(() => codeBlock.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true)
    })

    test('renders markdown preview with a mermaid diagram by default', async ({ page }) => {
        await gotoFile(page, 'README.md')

        await expect(page.getByTestId('md-preview')).toBeVisible()
        await expect(page.getByRole('heading', { name: 'Markdown preview heading' })).toBeVisible()

        // Mermaid renders to an <svg> inside the rendered-diagram trigger.
        const diagram = page.locator('[data-mermaid-diagram][data-rendered="true"]')
        await expect(diagram).toBeVisible()
        await expect(diagram.locator('svg')).toBeVisible()
    })

    test('mermaid diagram zooms into an overlay and closes', async ({ page }) => {
        await gotoFile(page, 'README.md')

        const trigger = page.locator('[data-mermaid-zoom-trigger]')
        await expect(trigger).toBeVisible()
        await trigger.click()

        const overlay = page.locator('[data-mermaid-zoom-overlay]')
        await expect(overlay).toBeVisible()
        await expect(overlay.getByRole('document')).toBeVisible()

        // Escape closes it.
        await page.keyboard.press('Escape')
        await expect(overlay).toHaveCount(0)

        // Re-open and close via the close button.
        await trigger.click()
        await expect(page.locator('[data-mermaid-zoom-overlay]')).toBeVisible()
        await page.locator('[data-mermaid-zoom-close]').click()
        await expect(page.locator('[data-mermaid-zoom-overlay]')).toHaveCount(0)
    })

    test('preview/raw toggle switches between rendered markdown and raw source', async ({ page }) => {
        await gotoFile(page, 'README.md')

        await expect(page.getByTestId('md-preview')).toBeVisible()
        await expect(page.getByTestId('file-raw-pre')).toHaveCount(0)

        await page.getByTestId('md-raw-toggle').click()
        await expect(page.getByTestId('file-raw-pre')).toBeVisible()
        await expect(page.getByTestId('md-preview')).toHaveCount(0)

        await page.getByTestId('md-preview-toggle').click()
        await expect(page.getByTestId('md-preview')).toBeVisible()
        await expect(page.getByTestId('file-raw-pre')).toHaveCount(0)
    })
})

test.describe('file viewer — word wrap', () => {
    test('word-wrap toggle flips the pre wrapping and persists across reload', async ({ page }) => {
        await gotoFile(page, 'notes.txt')

        const pre = page.getByTestId('file-raw-pre')
        await expect(pre).toBeVisible()
        await expect(pre).toHaveAttribute('data-word-wrap', 'off')

        await page.getByTestId('word-wrap-toggle').click()
        await expect(pre).toHaveAttribute('data-word-wrap', 'on')

        // Preference is persisted to localStorage → survives a full reload.
        await page.reload()
        await expect(page.getByTestId('file-viewer-host')).toBeVisible()
        await expect(page.getByTestId('file-raw-pre')).toHaveAttribute('data-word-wrap', 'on')
    })

    test('non-markdown files do not show the preview/raw toggle', async ({ page }) => {
        await gotoFile(page, 'notes.txt')

        await expect(page.getByTestId('file-raw-pre')).toBeVisible()
        await expect(page.getByTestId('md-preview-toggle')).toHaveCount(0)
        await expect(page.getByTestId('word-wrap-toggle')).toBeVisible()
    })
})
