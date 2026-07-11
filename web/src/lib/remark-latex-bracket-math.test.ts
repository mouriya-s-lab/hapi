import { describe, expect, it } from 'vitest'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import remarkRehype from 'remark-rehype'
import rehypeKatex from 'rehype-katex'
import { toHtml } from 'hast-util-to-html'
import {
    MARKDOWN_PLUGINS,
    MARKDOWN_PLUGINS_WITH_BREAKS,
    MARKDOWN_REHYPE_PLUGINS,
} from '@/components/assistant-ui/markdown-text'
import remarkLatexBracketMath from '@/lib/remark-latex-bracket-math'

function render(markdown: string): string {
    const processor = unified()
        .use(remarkParse)
        .use(remarkGfm)
        .use(remarkLatexBracketMath)
        .use(remarkMath, { singleDollarTextMath: false })
        .use(remarkRehype)
        .use(rehypeKatex)
    return toHtml(processor.runSync(processor.parse(markdown), markdown))
}

function renderProduction(markdown: string, withBreaks = false): string {
    const processor = unified()
        .use(remarkParse)
        .use(withBreaks ? MARKDOWN_PLUGINS_WITH_BREAKS : MARKDOWN_PLUGINS)
        .use(remarkRehype)
        .use(MARKDOWN_REHYPE_PLUGINS)
    return toHtml(processor.runSync(processor.parse(markdown), markdown))
}

describe('remarkLatexBracketMath', () => {
    it('renders bracket display math through KaTeX', () => {
        const html = render(String.raw`\[ 164.7亿\times\frac{599}{1440} \approx\boxed{68.5亿} \]`)
        expect(html).toContain('class="katex"')
        expect(html).toContain('katex-display')
        expect(html).toContain('mfrac')
        expect(html).not.toContain('[ 164.7')
    })

    it('renders parenthesized inline math without display mode', () => {
        const html = render(String.raw`Result: \(x^2 + y^2\).`)
        expect(html).toContain('class="katex"')
        expect(html).not.toContain('katex-display')
        expect(html).toContain('Result: ')
    })

    it('renders multiline display math before hard-break processing', () => {
        const html = renderProduction('Before\n\n\\[\nE = mc^2\n\\]\n\nAfter', true)
        expect(html).toContain('katex-display')
        expect(html).toContain('Before')
        expect(html).toContain('After')
    })

    it('renders multiple inline formulas', () => {
        const html = render(String.raw`Compare \(a^2\) with \(b^2\).`)
        expect(html.match(/class="katex"/g)).toHaveLength(2)
    })

    it.each([
        ['citation', 'See [1].'],
        ['ordinary parentheses', 'Do this (see above).'],
        ['Windows path', String.raw`Open (C:\Users\Admin\notes).`],
        ['inline code', 'Use `\\(x\\)`.'],
        ['fenced code', '```tex\n\\[x\\]\n```'],
    ])('leaves %s as text', (_name, markdown) => {
        expect(render(markdown)).not.toContain('class="katex"')
    })

    it('preserves dollar block math and currency prose', () => {
        expect(render('$$\nE = mc^2\n$$')).toContain('class="katex"')
        expect(renderProduction('The plan is $200/mo and the bill is $80.')).not.toContain('class="katex"')
    })

    it('uses the production assistant plugin chain', () => {
        expect(renderProduction(String.raw`\[a^2+b^2=c^2\]`)).toContain('katex-display')
    })
})
