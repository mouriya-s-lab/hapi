/*
 * End-to-end coverage for the markdown-preview + word-wrap toggles on the
 * tool-card file-preview popup (the "click a file in chat → popup preview"
 * surface). This is the follow-up that brings issue #3's file-viewer toggles to
 * the Read tool result rendered at surface="dialog".
 *
 * These specs drive a real Chromium against
 * `web/e2e-fixtures/tool-file-preview-fixture.html` (vite dev), which mounts the
 * production Read result view at surface="dialog" behind a minimal provider set.
 * The file under view is chosen with `?file=` so each test exercises either the
 * markdown (.md) path or the plain-text (word-wrap) path. Each test gets a fresh
 * browser context, so localStorage preferences start clean.
 */

import { test, expect, Page } from '@playwright/test'

async function gotoPreview(
    page: Page,
    file: string,
    tool: 'read' | 'write' = 'read',
    opts: { readFormat?: 'structured' | 'lineNumbers' } = {}
): Promise<void> {
    const params = new URLSearchParams({ tool, file })
    if (opts.readFormat) params.set('readFormat', opts.readFormat)
    await page.goto(`/e2e-fixtures/tool-file-preview-fixture.html?${params.toString()}`)
    await expect(page.getByTestId('tool-file-preview-host')).toBeVisible()
}

test.describe('tool file preview — markdown', () => {
    test('renders markdown preview by default for a .md file', async ({ page }) => {
        await gotoPreview(page, 'README.md')

        await expect(page.getByTestId('md-preview')).toBeVisible()
        await expect(page.getByRole('heading', { name: 'Markdown preview heading' })).toBeVisible()
        await expect(page.getByTestId('file-raw-pre')).toHaveCount(0)
    })

    test('preview/raw toggle switches between rendered markdown and raw source', async ({ page }) => {
        await gotoPreview(page, 'README.md')

        await expect(page.getByTestId('md-preview')).toBeVisible()

        await page.getByTestId('md-raw-toggle').click()
        await expect(page.getByTestId('file-raw-pre')).toBeVisible()
        await expect(page.getByTestId('md-preview')).toHaveCount(0)

        await page.getByTestId('md-preview-toggle').click()
        await expect(page.getByTestId('md-preview')).toBeVisible()
        await expect(page.getByTestId('file-raw-pre')).toHaveCount(0)
    })

    // Real Claude Code Read results come back as one long string with every
    // line wrapped by "<N>\t" (cat -n). The preview must strip that so
    // markdown parses normally, but the raw tab must keep the numbers.
    test('strips "N\\t" line-number prefix in preview and keeps it in raw', async ({ page }) => {
        await gotoPreview(page, 'README.md', 'read', { readFormat: 'lineNumbers' })

        const preview = page.getByTestId('md-preview')
        await expect(preview).toBeVisible()
        await expect(
            preview.getByRole('heading', { name: 'Markdown preview heading' })
        ).toBeVisible()
        // A markdown table must actually render as a <table>, not survive as
        // pipe-and-dash characters inside a paragraph.
        await expect(preview.locator('table')).toBeVisible()
        // The "1\t", "2\t", … column must not leak into the rendered markdown.
        await expect(preview).not.toContainText(/^\s*1\s/m)

        await page.getByTestId('md-raw-toggle').click()
        const raw = page.getByTestId('file-raw-pre')
        await expect(raw).toBeVisible()
        // Raw view keeps the source line numbers so the user can still see
        // what Read returned line-by-line.
        await expect(raw).toContainText('1\t# Markdown preview heading')
    })
})

test.describe('tool file preview — word wrap', () => {
    test('word-wrap toggle flips the pre wrapping and persists across reload', async ({ page }) => {
        await gotoPreview(page, 'notes.txt')

        const pre = page.getByTestId('file-raw-pre')
        await expect(pre).toBeVisible()
        await expect(pre).toHaveAttribute('data-word-wrap', 'off')

        await page.getByTestId('word-wrap-toggle').click()
        await expect(pre).toHaveAttribute('data-word-wrap', 'on')

        // Preference is persisted to localStorage → survives a full reload.
        await page.reload()
        await expect(page.getByTestId('tool-file-preview-host')).toBeVisible()
        await expect(page.getByTestId('file-raw-pre')).toHaveAttribute('data-word-wrap', 'on')
    })

    test('non-markdown files do not show the preview/raw toggle', async ({ page }) => {
        await gotoPreview(page, 'notes.txt')

        await expect(page.getByTestId('file-raw-pre')).toBeVisible()
        await expect(page.getByTestId('md-preview-toggle')).toHaveCount(0)
        await expect(page.getByTestId('word-wrap-toggle')).toBeVisible()
    })
})

// The Write tool also produces a file-preview popup in chat (it outputs a file);
// its DRAFT/input view must offer the same toggles as Read.
test.describe('tool file preview — Write surface', () => {
    test('md write shows markdown preview + preview/raw toggle', async ({ page }) => {
        await gotoPreview(page, 'README.md', 'write')

        await expect(page.getByTestId('md-preview')).toBeVisible()
        await expect(page.getByTestId('md-raw-toggle')).toBeVisible()

        await page.getByTestId('md-raw-toggle').click()
        await expect(page.getByTestId('file-raw-pre')).toBeVisible()
        await expect(page.getByTestId('word-wrap-toggle')).toBeVisible()
    })

    test('txt write shows only the word-wrap toggle', async ({ page }) => {
        await gotoPreview(page, 'notes.txt', 'write')

        await expect(page.getByTestId('file-raw-pre')).toBeVisible()
        await expect(page.getByTestId('md-preview-toggle')).toHaveCount(0)
        await expect(page.getByTestId('word-wrap-toggle')).toBeVisible()
    })
})
