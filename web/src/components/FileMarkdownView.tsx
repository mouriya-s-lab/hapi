import type { ComponentPropsWithoutRef, ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { MermaidDiagram } from '@/components/assistant-ui/mermaid-diagram'
import { SyntaxHighlighter } from '@/components/assistant-ui/shiki-highlighter'
import { denyOnlyTransform } from '@/components/assistant-ui/markdown-text'
import { cn } from '@/lib/utils'

// Standalone markdown renderer for the file viewer (issue #3).
//
// It deliberately does NOT reuse the chat's MarkdownText / MarkdownRenderer:
// those wrap @assistant-ui's MarkdownTextPrimitive, whose internal useSmooth()
// reads the `message` scope and therefore only works inside a rendered chat
// thread. The file viewer is a plain route with no thread, so this component
// renders markdown directly with react-markdown, reusing the shared Mermaid +
// Shiki building blocks and the chat's `aui-md-*` class names so styling stays
// consistent (those classes are defined globally in index.css).
//
// katex CSS is imported once globally in index.css, so math rendered by
// rehype-katex is styled without an extra import here.

const REMARK_PLUGINS = [remarkGfm, remarkMath]
const REHYPE_PLUGINS = [rehypeKatex]

// Both MermaidDiagram and SyntaxHighlighter share @assistant-ui's
// SyntaxHighlighterProps, which requires a `components` map. Neither actually
// reads it for our use, so a pass-through pair satisfies the type.
const HIGHLIGHTER_COMPONENTS = {
    Pre: (props: ComponentPropsWithoutRef<'pre'>) => <pre {...props} />,
    Code: (props: ComponentPropsWithoutRef<'code'>) => <code {...props} />,
}

function extractText(children: ReactNode): string {
    if (children == null || children === false || children === true) return ''
    if (typeof children === 'string') return children
    if (typeof children === 'number') return String(children)
    if (Array.isArray(children)) return children.map(extractText).join('')
    return ''
}

function CodeBlock(props: ComponentPropsWithoutRef<'code'>) {
    const { className, children } = props
    const match = /language-([\w-]+)/.exec(className ?? '')
    const text = extractText(children).replace(/\n$/, '')
    const isBlock = Boolean(match) || text.includes('\n')

    if (isBlock) {
        const language = match?.[1]
        if (language === 'mermaid') {
            return <MermaidDiagram code={text} language="mermaid" components={HIGHLIGHTER_COMPONENTS} />
        }
        return <SyntaxHighlighter code={text} language={language ?? 'text'} components={HIGHLIGHTER_COMPONENTS} />
    }

    return (
        <code className="aui-md-code break-words rounded-md border border-[var(--app-inline-code-border)] bg-[var(--app-inline-code-bg)] px-[0.38em] py-[0.14em] font-mono text-[0.88em] text-[var(--app-inline-code-fg)]">
            {children}
        </code>
    )
}

const components: Components = {
    // Fenced blocks are fully rendered by CodeBlock, so unwrap the default
    // <pre> to avoid nesting a block element (mermaid/shiki container) in <pre>.
    pre: ({ children }) => <>{children}</>,
    code: CodeBlock,
    a: ({ href, children, ...rest }) => (
        <a
            {...rest}
            href={href}
            target="_blank"
            rel="noreferrer"
            className="aui-md-a font-medium text-[var(--app-link)] underline decoration-[color:var(--app-link-muted)] underline-offset-3"
        >
            {children}
        </a>
    ),
    img: ({ className, ...rest }) => (
        // eslint-disable-next-line jsx-a11y/alt-text -- alt comes from markdown
        <img {...rest} className={cn('aui-md-img my-3 max-w-full rounded-xl', className)} />
    ),
    p: ({ className, ...rest }) => <p {...rest} className={cn('aui-md-p my-2.5 leading-7 first:mt-0 last:mb-0', className)} />,
    h1: ({ className, ...rest }) => <h1 {...rest} className={cn('aui-md-h1 mt-4 text-[1.05rem] font-semibold tracking-[-0.01em] first:mt-0', className)} />,
    h2: ({ className, ...rest }) => <h2 {...rest} className={cn('aui-md-h2 mt-4 text-base font-semibold tracking-[-0.01em] first:mt-0', className)} />,
    h3: ({ className, ...rest }) => <h3 {...rest} className={cn('aui-md-h3 mt-3 text-[0.95rem] font-semibold first:mt-0', className)} />,
    h4: ({ className, ...rest }) => <h4 {...rest} className={cn('aui-md-h4 mt-3 text-[0.92rem] font-semibold first:mt-0', className)} />,
    h5: ({ className, ...rest }) => <h5 {...rest} className={cn('aui-md-h5 mt-2.5 text-[0.9rem] font-semibold first:mt-0', className)} />,
    h6: ({ className, ...rest }) => <h6 {...rest} className={cn('aui-md-h6 mt-2.5 text-[0.88rem] font-semibold first:mt-0', className)} />,
    strong: ({ className, ...rest }) => <strong {...rest} className={cn('aui-md-strong font-semibold text-[var(--app-fg)]', className)} />,
    em: ({ className, ...rest }) => <em {...rest} className={cn('aui-md-em italic', className)} />,
    blockquote: ({ className, ...rest }) => (
        <blockquote
            {...rest}
            className={cn('aui-md-blockquote my-3 rounded-r-2xl border-l-[3px] border-[var(--app-md-quote-border)] bg-[var(--app-md-quote-bg)] px-4 py-3 text-[var(--app-md-quote-fg)]', className)}
        />
    ),
    ul: ({ className, ...rest }) => <ul {...rest} className={cn('aui-md-ul my-2.5 list-disc pl-6 marker:text-[var(--app-hint)] [&>li]:mt-1.5', className)} />,
    ol: ({ className, ...rest }) => <ol {...rest} className={cn('aui-md-ol my-2.5 list-decimal pl-6 marker:text-[var(--app-hint)] [&>li]:mt-1.5', className)} />,
    li: ({ className, ...rest }) => <li {...rest} className={cn('aui-md-li leading-7', className)} />,
    hr: ({ className, ...rest }) => <hr {...rest} className={cn('aui-md-hr my-4 border-[var(--app-divider)]', className)} />,
    table: ({ className, ...rest }) => (
        <div className="aui-md-table-wrapper my-3 max-w-full overflow-x-auto rounded-xl bg-[var(--app-md-table-bg)]">
            <table {...rest} className={cn('aui-md-table w-full border-collapse text-sm', className)} />
        </div>
    ),
    thead: ({ className, ...rest }) => <thead {...rest} className={cn('aui-md-thead bg-[var(--app-md-table-head-bg)]', className)} />,
    tbody: ({ className, ...rest }) => <tbody {...rest} className={cn('aui-md-tbody', className)} />,
    tr: ({ className, ...rest }) => <tr {...rest} className={cn('aui-md-tr border-t border-[var(--app-divider)] first:border-t-0', className)} />,
    th: ({ className, ...rest }) => <th {...rest} className={cn('aui-md-th px-3 py-2 text-left font-semibold text-[var(--app-fg)]', className)} />,
    td: ({ className, ...rest }) => <td {...rest} className={cn('aui-md-td px-3 py-2 align-top text-[var(--app-fg)]', className)} />,
}

export function FileMarkdownView(props: { content: string; className?: string }) {
    return (
        <div className={cn('aui-md min-w-0 max-w-full break-words text-[var(--app-fg)]', props.className)}>
            <ReactMarkdown
                remarkPlugins={REMARK_PLUGINS}
                rehypePlugins={REHYPE_PLUGINS}
                urlTransform={denyOnlyTransform}
                components={components}
            >
                {props.content}
            </ReactMarkdown>
        </div>
    )
}
