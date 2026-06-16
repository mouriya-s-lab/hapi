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

    it('links Windows absolute paths', () => {
        const nodes = transform('Saved C:\\Users\\Administrator\\Desktop\\report.docx')
        const link = nodes.find((node) => node.type === 'link')

        expect(linkedPath(link!)).toBe('C:\\Users\\Administrator\\Desktop\\report.docx')
    })

    it('does not link parent traversal paths', () => {
        const nodes = transform('Skip ../a.png and folder/../a.png')

        expect(nodes.some((node) => node.type === 'link')).toBe(false)
    })

    it('does not rewrite ordinary urls', () => {
        const nodes = transform('Visit https://example.com/web/src/router.tsx')

        expect(nodes.some((node) => node.type === 'link')).toBe(false)
    })
})
