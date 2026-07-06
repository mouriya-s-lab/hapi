import { describe, expect, it } from 'vitest'
import { decodeFilePathHref, remarkFilePathLinks } from '@/lib/remark-file-path-links'

type TestNode = {
    type: string
    value?: string
    url?: string
    children?: TestNode[]
}

function transform(text: string): TestNode[] {
    const tree: TestNode = {
        type: 'root',
        children: [{ type: 'paragraph', children: [{ type: 'text', value: text }] }]
    }
    remarkFilePathLinks()(tree)
    return tree.children?.[0]?.children ?? []
}

function linkedPath(node: TestNode): string | null {
    return typeof node.url === 'string' ? decodeFilePathHref(node.url) : null
}

describe('remarkFilePathLinks', () => {
    it('links relative code paths and strips line suffixes from the target path', () => {
        const nodes = transform('Open web/src/router.tsx:42 please')
        const link = nodes.find((node) => node.type === 'link')

        expect(link?.children?.[0]?.value).toBe('web/src/router.tsx:42')
        expect(linkedPath(link!)).toBe('web/src/router.tsx')
    })

    it('links image and markdown filenames for preview', () => {
        const nodes = transform('See screenshot.png and README.md')
        const links = nodes.filter((node) => node.type === 'link')

        expect(links.map(linkedPath)).toEqual(['screenshot.png', 'README.md'])
    })
    it('links absolute Unix and home paths for output files', () => {
        const nodes = transform('Saved /tmp/render_test.png and ~/Downloads/report.pdf')
        const links = nodes.filter((node) => node.type === 'link')

        expect(links.map(linkedPath)).toEqual(['/tmp/render_test.png', '~/Downloads/report.pdf'])
    })

    it('links absolute POSIX and home-relative paths', () => {
        const nodes = transform('Open /Users/dev/project/a.png and ~/notes.md')
        const links = nodes.filter((node) => node.type === 'link')
        expect(links.map(linkedPath)).toEqual(['/Users/dev/project/a.png', '~/notes.md'])
    })

    it('links Windows drive-absolute paths (both slash flavors)', () => {
        const nodes = transform('See C:\\tmp\\report.pdf or D:/logs/build.log')
        const links = nodes.filter((node) => node.type === 'link')
        expect(links.map(linkedPath)).toEqual(['C:\\tmp\\report.pdf', 'D:/logs/build.log'])
    })

    it('still refuses parent-traversal paths', () => {
        const nodes = transform('bad ../a.png and worse foo/../a.png')
        expect(nodes.some((node) => node.type === 'link')).toBe(false)
    })

    it('recognizes doc/pdf/office/archive/log extensions', () => {
        const nodes = transform('deck.pptx report.pdf sheet.xlsx trace.log bundle.tar.gz')
        const links = nodes.filter((node) => node.type === 'link')
        // Note: "bundle.tar.gz" matches only the trailing ".gz" segment; that's
        // acceptable — the file page reads the same underlying path either way.
        const targets = links.map(linkedPath)
        expect(targets).toContain('deck.pptx')
        expect(targets).toContain('report.pdf')
        expect(targets).toContain('sheet.xlsx')
        expect(targets).toContain('trace.log')
    })

    it('does not rewrite ordinary urls', () => {
        const nodes = transform('Visit https://example.com/web/src/router.tsx')

        expect(nodes.some((node) => node.type === 'link')).toBe(false)
    })

    it('does not rewrite path-like fragments inside a URL', () => {
        // Even though "example.com/foo.png" superficially matches the pattern,
        // the surrounding "https://" token prefix disqualifies it as a link.
        const nodes = transform('Docs at https://example.com/assets/logo.png please')
        expect(nodes.some((node) => node.type === 'link')).toBe(false)
    })
})
