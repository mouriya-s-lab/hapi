import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import remarkRehype from 'remark-rehype'
import { toHtml } from 'hast-util-to-html'
import remarkLatexBracketMath from '@/lib/remark-latex-bracket-math'
import {
    MARKDOWN_PLUGINS,
    MARKDOWN_PLUGINS_WITH_BREAKS,
    MARKDOWN_REHYPE_PLUGINS,
} from '@/components/assistant-ui/markdown-text'

// Render through a minimal chain that isolates this plugin: parse → gfm →
// bracket-math → math → rehype → katex. Mirrors how the app wires it up.
function render(markdown: string): string {
    const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkLatexBracketMath)
        .use(remarkMath, { singleDollarTextMath: false })
        .use(remarkRehype)
        .use(rehypeKatex)
    const tree = processor.runSync(processor.parse(markdown), markdown)
    return toHtml(tree as never)
}

// Render through the *real* production plugin chains so ordering regressions
// (e.g. remarkBreaks fragmenting a block before this plugin runs) are caught.
function renderWith(
    plugins: typeof MARKDOWN_PLUGINS | typeof MARKDOWN_PLUGINS_WITH_BREAKS,
    markdown: string,
): string {
    const processor = unified()
        .use(remarkParse)
        .use(plugins)
        .use(remarkRehype)
        .use(MARKDOWN_REHYPE_PLUGINS)
    const tree = processor.runSync(processor.parse(markdown), markdown)
    return toHtml(tree as never)
}

describe('remarkLatexBracketMath', () => {
    it('renders the reported \\[ … \\] display formula as KaTeX', () => {
        const md = String.raw`\[ 164.7亿\times\frac{599}{1440} \approx\boxed{68.5亿\ tokens} \]`
        const html = render(md)
        expect(html).toContain('class="katex"')
        expect(html).toContain('katex-display')
        // The TeX was actually laid out (fraction rendered), not dumped as text.
        expect(html).toContain('mfrac')
        // The literal bracketed prose `[ 164.7…` must not survive — the leading
        // `[` delimiter is consumed on a successful conversion (KaTeX's x-tex
        // annotation keeps the inner TeX but never the surrounding brackets).
        expect(html).not.toContain('[ 164.7')
    })

    it('renders \\( … \\) as inline KaTeX without display mode', () => {
        const html = render(String.raw`The result is \( x^2 + y^2 \) inline.`)
        expect(html).toContain('class="katex"')
        expect(html).not.toContain('katex-display')
        expect(html).toContain('The result is ')
        expect(html).toContain(' inline.')
    })

    it('renders a multi-line block \\[ … \\] on its own lines', () => {
        const html = render('Before\n\n\\[\nE = mc^2\n\\]\n\nAfter')
        expect(html).toContain('class="katex"')
        expect(html).toContain('katex-display')
        expect(html).toContain('Before')
        expect(html).toContain('After')
    })

    it('hoists a lone display formula out of its <p> wrapper', () => {
        const html = render(String.raw`\[ a + b \]`)
        // katex-display should not be nested inside a paragraph.
        expect(html).not.toMatch(/<p>[^]*katex-display/)
    })

    it('handles multiple inline formulas and surrounding prose in one line', () => {
        const html = render(String.raw`Compare \( a^2 \) with \( b^2 \) here.`)
        const count = (html.match(/class="katex"/g) ?? []).length
        expect(count).toBe(2)
        expect(html).toContain('Compare ')
        expect(html).toContain(' with ')
        expect(html).toContain(' here.')
    })

    // ── False-positive guards: bare brackets that were never delimiters ──

    it('leaves a citation like [1] as plain text', () => {
        const html = render('See reference [1] for details.')
        expect(html).not.toContain('class="katex"')
        expect(html).toContain('[1]')
    })

    it('leaves a parenthetical like (see above) as plain text', () => {
        const html = render('Do this (see above) first.')
        expect(html).not.toContain('class="katex"')
        expect(html).toContain('(see above)')
    })

    it('leaves a Windows path in parentheses untouched', () => {
        const html = render(String.raw`Open the folder (C:\Users\Admin\notes) now.`)
        expect(html).not.toContain('class="katex"')
        expect(html).toContain('Users')
    })

    it('does not touch \\[ … \\]-looking text inside inline code', () => {
        const html = render('Use `\\( x \\)` to write inline math.')
        expect(html).not.toContain('class="katex"')
        expect(html).toContain('<code')
    })

    it('does not touch delimiters inside a fenced code block', () => {
        const html = render('```\n\\[ x + y \\]\n```')
        expect(html).not.toContain('class="katex"')
    })

    it('still lets remark-math handle $$ … $$ blocks', () => {
        const html = render('$$\nE = mc^2\n$$')
        expect(html).toContain('class="katex"')
    })
})

describe('remarkLatexBracketMath — production plugin chains', () => {
    it('renders \\[ … \\] via MARKDOWN_PLUGINS (assistant path)', () => {
        const html = renderWith(MARKDOWN_PLUGINS, String.raw`\[ a^2 + b^2 = c^2 \]`)
        expect(html).toContain('class="katex"')
    })

    it('renders a multi-line block via MARKDOWN_PLUGINS_WITH_BREAKS (user-prompt path)', () => {
        // Regression: remarkBreaks must not fragment the block before this plugin
        // runs — the plugin sits ahead of remarkBreaks in that chain.
        const html = renderWith(MARKDOWN_PLUGINS_WITH_BREAKS, 'Given\n\n\\[\na = b\n\\]\n\nend')
        expect(html).toContain('class="katex"')
    })

    it('does not regress currency prose (no single-$ math)', () => {
        const html = renderWith(MARKDOWN_PLUGINS, 'The plan is $200/mo and the bill is $80.')
        expect(html).not.toContain('class="katex"')
        expect(html).toContain('$200')
        expect(html).toContain('$80')
    })
})
