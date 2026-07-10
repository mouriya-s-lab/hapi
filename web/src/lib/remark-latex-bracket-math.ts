/**
 * Remark plugin: render LaTeX `\[ … \]` (display) and `\( … \)` (inline)
 * delimiters as math, complementing remark-math's native `$…$` / `$$…$$`.
 *
 * Why this is needed
 * ------------------
 * Many models emit math with TeX-style delimiters `\[ … \]` (display) and
 * `\( … \)` (inline) instead of dollar signs. remark-math only tokenises `$`,
 * so those spans fall through to plain text. Worse, CommonMark treats a
 * backslash before `[ ] ( )` as a *character escape*, so at parse time `\[`
 * collapses to a literal `[` — the delimiter markers vanish from the parsed
 * text node's `value`, and the TeX (e.g. `\times`, `\frac{…}`) is left as prose.
 * That is exactly why a formula like
 *   \[ 164.7亿\times\frac{599}{1440} \approx\boxed{68.5亿\ tokens} \]
 * shows up on screen as the raw string `[ 164.7亿\times… ]`.
 *
 * How it works
 * -----------
 * A parsed text node's `position` still spans the *original* source, so we
 * recover the raw slice from `file.value` (backslashes intact) and match the
 * real `\[ … \]` / `\( … \)` delimiters there. Recovering from raw source — not
 * the escape-stripped `value` — gives two properties:
 *   1. We never misfire on bare brackets that were never delimiters — the
 *      citation `[1]`, a parenthetical `(see above)`, or a Windows path
 *      `(C:\Users\x)` contain no literal `\[` / `\(`, so they are left alone.
 *   2. The TeX handed to KaTeX keeps its exact backslashes (`\{`, `\_`, …)
 *      rather than the escape-stripped `value`.
 *
 * A per-node alignment guard (`deEscape(raw) === node.value`) makes the offset
 * recovery robust even though `remark-repair-tables` re-parses the tree without
 * rewriting `file.value`: when offsets are shifted (or an HTML entity sits in
 * the same node) the guard fails and we simply leave the text untouched.
 *
 * Matched spans become `math` / `inlineMath` mdast nodes whose `data` mirrors
 * mdast-util-math exactly (`hName` + `language-math math-display/inline`
 * classes), so remark-rehype → rehype-katex renders them identically to
 * `$$` / `$`. A paragraph that reduces to a lone display formula is hoisted out
 * of its `<p>` wrapper so it matches how remark-math emits `$$` blocks.
 *
 * Pipeline position: after remark-gfm / table repair, and BEFORE remark-breaks
 * and the autolink/URI plugins — so multi-line `\[ … \]` is not fragmented by
 * hard-break splitting, and URL-like text inside TeX is never linkified.
 * remark-math's array position is irrelevant (it is a parse-time syntax
 * extension with no tree transformer).
 */

interface MdastNode {
    type: string
    value?: string
    children?: MdastNode[]
    position?: { start?: { offset?: number }; end?: { offset?: number } }
    data?: unknown
}

interface VFileLike {
    value?: unknown
}

// `\[ … \]` (display) or `\( … \)` (inline). Lazy inner match; `[\s\S]` so the
// span can cross newlines (block form emits `\[\n…\n\]` in one text node).
const DELIM_RE = /\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)/g

// CommonMark backslash escapes: `\` + ASCII punctuation → the punctuation char.
// Reproduces markdown's own de-escaping so recovered raw source can be compared
// against (and substituted for) a parsed text node's `value`.
const MD_ESCAPE_RE = /\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g

// Node types whose textual content must never be reinterpreted as math, and
// into which we do not descend (code spans/blocks, existing math, link text,
// raw HTML).
const SKIP_TYPES = new Set([
    'code',
    'inlineCode',
    'math',
    'inlineMath',
    'link',
    'linkReference',
    'html',
])

function deEscape(s: string): string {
    return s.replace(MD_ESCAPE_RE, '$1')
}

// Build nodes structurally identical to what mdast-util-math emits so the
// downstream remark-rehype → rehype-katex handoff is byte-for-byte the same as
// for `$$` / `$` math. See node_modules/mdast-util-math/lib/index.js.
function displayMathNode(tex: string): MdastNode {
    return {
        type: 'math',
        value: tex,
        data: {
            hName: 'pre',
            hChildren: [
                {
                    type: 'element',
                    tagName: 'code',
                    properties: { className: ['language-math', 'math-display'] },
                    children: [{ type: 'text', value: tex }],
                },
            ],
        },
    } as MdastNode
}

function inlineMathNode(tex: string): MdastNode {
    return {
        type: 'inlineMath',
        value: tex,
        data: {
            hName: 'code',
            hProperties: { className: ['language-math', 'math-inline'] },
            hChildren: [{ type: 'text', value: tex }],
        },
    } as MdastNode
}

/**
 * Split one text node into a mix of text / math / inlineMath nodes by matching
 * `\[ … \]` / `\( … \)` in the node's *raw source*. Returns `[node]` unchanged
 * when the node has no such delimiters, when its source offsets cannot be
 * recovered, or when the offsets fail the alignment guard.
 */
function splitTextNode(node: MdastNode, source: string): MdastNode[] {
    const start = node.position?.start?.offset
    const end = node.position?.end?.offset
    if (typeof start !== 'number' || typeof end !== 'number') return [node]

    const raw = source.slice(start, end)
    // Fast path: no TeX delimiters in the original source for this node.
    if (!raw.includes('\\[') && !raw.includes('\\(')) return [node]

    // Alignment guard: de-escaping the raw slice must reproduce the parsed
    // value. If it does not, the offsets are stale (e.g. shifted by table
    // repair) or the node holds an HTML entity — either way, leave it as text.
    if (deEscape(raw) !== (node.value ?? '')) return [node]

    DELIM_RE.lastIndex = 0
    let match = DELIM_RE.exec(raw)
    if (match === null) return [node]

    const out: MdastNode[] = []
    let last = 0
    while (match !== null) {
        if (match.index > last) {
            const prose = deEscape(raw.slice(last, match.index))
            if (prose) out.push({ type: 'text', value: prose })
        }

        const display = match[1]
        const inline = match[2]
        const tex = (display ?? inline ?? '').trim()
        if (tex) {
            out.push(display !== undefined ? displayMathNode(tex) : inlineMathNode(tex))
        } else {
            // Empty delimiters like `\[\]` — keep the de-escaped literal text.
            out.push({ type: 'text', value: deEscape(match[0]) })
        }

        last = match.index + match[0].length
        match = DELIM_RE.exec(raw)
    }

    if (last < raw.length) {
        const prose = deEscape(raw.slice(last))
        if (prose) out.push({ type: 'text', value: prose })
    }

    return out
}

function isDisplayMath(n: MdastNode): boolean {
    return n.type === 'math'
}

function isWhitespaceText(n: MdastNode): boolean {
    return n.type === 'text' && (n.value ?? '').trim() === ''
}

/**
 * When a paragraph reduces to one-or-more display formulas surrounded only by
 * whitespace, return just those math nodes so the caller can hoist them out of
 * the `<p>` — matching how remark-math emits `$$` blocks at the root level and
 * avoiding a redundant paragraph wrapper (and its margins) around the formula.
 */
function hoistParagraph(paragraph: MdastNode): MdastNode[] | null {
    const kids = paragraph.children ?? []
    const maths = kids.filter(isDisplayMath)
    if (maths.length === 0) return null
    if (!kids.every((c) => isDisplayMath(c) || isWhitespaceText(c))) return null
    return maths
}

function processContainer(node: MdastNode, source: string): void {
    if (!Array.isArray(node.children)) return

    const out: MdastNode[] = []
    for (const child of node.children) {
        if (SKIP_TYPES.has(child.type)) {
            out.push(child)
            continue
        }

        if (child.type === 'text') {
            out.push(...splitTextNode(child, source))
            continue
        }

        processContainer(child, source)

        if (child.type === 'paragraph') {
            const hoisted = hoistParagraph(child)
            if (hoisted) {
                out.push(...hoisted)
                continue
            }
        }

        out.push(child)
    }

    node.children = out
}

export default function remarkLatexBracketMath() {
    return (tree: MdastNode, file: VFileLike) => {
        const source = typeof file?.value === 'string' ? file.value : null
        if (source === null) return
        processContainer(tree, source)
    }
}
