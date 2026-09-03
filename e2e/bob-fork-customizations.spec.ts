/*
 * End-to-end coverage for the bob-fork-customizations import
 * (bobmcmxciv/hapi@1a6684d5, selectively cherry-picked; see
 * `fork-features/trunk-patches.md` § bob-fork-customizations).
 *
 * The fixture at `web/e2e-fixtures/bob-fork-customizations-fixture.html`
 * mounts, in isolation, the three UI-observable pieces of the change:
 *   §1 Read result view (surface="inline") on a base64 image
 *   §2 Chat MarkdownRenderer with a `![](data:image/png;base64,…)` node
 *   §3 Chat MarkdownRenderer with absolute / Windows / home-relative paths
 *
 * The remaining two pieces from the import (SessionList host fallback,
 * HappyComposer IME 229) are behavior-observable only inside a live chat
 * with a running hub + cli, and are covered by their unit tests plus a
 * post-deploy smoke note in the PR body.
 */

import { test, expect, Page } from '@playwright/test'

async function gotoFixture(page: Page): Promise<void> {
    await page.goto('/e2e-fixtures/bob-fork-customizations-fixture.html')
    // The three sections mount concurrently once React commits; wait on the
    // last one so the whole tree is settled before we start asserting.
    await expect(page.getByTestId('section-markdown-paths')).toBeVisible()
}

test.describe('bob-fork-customizations', () => {
    test('§1 Read tool result renders base64 image inline', async ({ page }) => {
        await gotoFixture(page)
        const section = page.getByTestId('section-read-image')
        const img = section.locator('img')
        await expect(img).toHaveCount(1)
        const src = await img.getAttribute('src')
        expect(src).toMatch(/^data:image\/png;base64,/)
    })

    test('§2 chat markdown allows data:image/* URLs (denyOnlyTransform)', async ({ page }) => {
        await gotoFixture(page)
        const section = page.getByTestId('section-markdown-data-image')
        // The `![tiny pixel](data:image/png;base64,…)` node must survive with
        // its src intact — the pre-change denyOnlyTransform stripped it to ''.
        const img = section.locator('img[alt="tiny pixel"]')
        await expect(img).toHaveCount(1)
        const src = await img.getAttribute('src')
        expect(src).toMatch(/^data:image\/png;base64,/)
    })

    test('§3 chat markdown links absolute / Windows / home-relative paths', async ({ page }) => {
        await gotoFixture(page)
        const section = page.getByTestId('section-markdown-paths')

        // Each of these must be linkified with the fork's hapi-file: href.
        // The href is percent-encoded, so match against the decoded prefix.
        const wantedTargets = ['/Users/dev/project/report.pdf', '~/notes.md', 'C:\\logs\\build.log', 'cli/src/main.ts']
        for (const target of wantedTargets) {
            const link = section.locator(`a[href^="hapi-file:"]`).filter({ hasText: target.replace(/\\/g, '\\') })
            await expect(link.first(), `expected a hapi-file link for ${target}`).toBeVisible()
        }

        // The URL in the same block must NOT be turned into a hapi-file link.
        // It stays as an ordinary anchor pointing to example.com.
        const externalLink = section.locator('a[href^="https://example.com"]')
        await expect(externalLink).toHaveCount(1)
        const fileLinksToExample = section.locator('a[href^="hapi-file:"]').filter({ hasText: 'example.com' })
        await expect(fileLinksToExample).toHaveCount(0)
    })
})
