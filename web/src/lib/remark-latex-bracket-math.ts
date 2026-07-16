interface MarkdownNode {
    type: string
    value?: string
    children?: MarkdownNode[]
    position?: {
        start?: { offset?: number }
        end?: { offset?: number }
    }
    data?: unknown
}

interface MarkdownFile {
    value?: unknown
}

const LATEX_DELIMITER = /\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g
const MARKDOWN_ESCAPE = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g
const OPAQUE_NODE_TYPES = new Set([
    'code',
    'inlineCode',
    'math',
    'inlineMath',
    'link',
    'linkReference',
    'html',
])

function decodeMarkdownEscapes(value: string): string {
    return value.replace(MARKDOWN_ESCAPE, '$1')
}

function mathNode(type: 'math' | 'inlineMath', value: string): MarkdownNode {
    if (type === 'math') {
        return {
            type,
            value,
            data: {
                hName: 'pre',
                hChildren: [{
                    type: 'element',
                    tagName: 'code',
                    properties: { className: ['language-math', 'math-display'] },
                    children: [{ type: 'text', value }],
                }],
            },
        }
    }

    return {
        type,
        value,
        data: {
            hName: 'code',
            hProperties: { className: ['language-math', 'math-inline'] },
            hChildren: [{ type: 'text', value }],
        },
    }
}

function splitTextNode(node: MarkdownNode, source: string): MarkdownNode[] {
    const start = node.position?.start?.offset
    const end = node.position?.end?.offset
    if (typeof start !== 'number' || typeof end !== 'number') return [node]

    const raw = source.slice(start, end)
    if (!raw.includes('\\[') && !raw.includes('\\(')) return [node]
    if (decodeMarkdownEscapes(raw) !== node.value) return [node]

    const matches = [...raw.matchAll(LATEX_DELIMITER)]
    if (matches.length === 0) return [node]

    const children: MarkdownNode[] = []
    let cursor = 0
    for (const match of matches) {
        const index = match.index
        if (index > cursor) {
            children.push({ type: 'text', value: decodeMarkdownEscapes(raw.slice(cursor, index)) })
        }

        const displayValue = match[1]
        const inlineValue = match[2]
        const value = (displayValue ?? inlineValue ?? '').trim()
        children.push(value.length > 0
            ? mathNode(displayValue === undefined ? 'inlineMath' : 'math', value)
            : { type: 'text', value: decodeMarkdownEscapes(match[0]) })
        cursor = index + match[0].length
    }

    if (cursor < raw.length) {
        children.push({ type: 'text', value: decodeMarkdownEscapes(raw.slice(cursor)) })
    }
    return children
}

function hoistedDisplayMath(node: MarkdownNode): MarkdownNode[] | null {
    const children = node.children ?? []
    const isDisplayOrWhitespace = (child: MarkdownNode) => child.type === 'math'
        || (child.type === 'text' && (child.value ?? '').trim().length === 0)
    if (!children.some((child) => child.type === 'math')) return null
    if (!children.every(isDisplayOrWhitespace)) return null
    return children.filter((child) => child.type === 'math')
}

function transformContainer(node: MarkdownNode, source: string): void {
    if (!node.children) return

    const children: MarkdownNode[] = []
    for (const child of node.children) {
        if (OPAQUE_NODE_TYPES.has(child.type)) {
            children.push(child)
            continue
        }
        if (child.type === 'text') {
            children.push(...splitTextNode(child, source))
            continue
        }

        transformContainer(child, source)
        const displayMath = child.type === 'paragraph' ? hoistedDisplayMath(child) : null
        children.push(...(displayMath ?? [child]))
    }
    node.children = children
}

/** Convert literal TeX bracket delimiters before CommonMark escape handling is lost downstream. */
export default function remarkLatexBracketMath() {
    return (tree: MarkdownNode, file: MarkdownFile): void => {
        if (typeof file.value !== 'string') return
        transformContainer(tree, file.value)
    }
}
