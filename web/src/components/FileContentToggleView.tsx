import { useMemo } from 'react'
import { useShikiHighlighter } from '@/lib/shiki'
import { CopyIcon, CheckIcon } from '@/components/icons'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useTranslation } from '@/lib/use-translation'
import { FileMarkdownView } from '@/components/FileMarkdownView'
import { useFileWordWrap, useFileMarkdownPreview } from '@/hooks/useFileViewPrefs'
import { isMarkdownPath, resolveLanguage } from '@/lib/file-preview'

// File-content view with the fork's markdown-preview + word-wrap toggles, for
// the tool-card detail dialog (the "click a file → popup preview" surface).
//
// This mirrors the content block of the full file-viewer route
// (routes/sessions/file.tsx): markdown files default to a rendered preview with
// a preview/raw switch, and the raw source view exposes a soft word-wrap
// toggle. It reuses the same FileMarkdownView renderer, the same persisted
// preferences (useFileViewPrefs), and the same data-testids, so behaviour stays
// identical to the route and a user's choice carries across both surfaces.

const MAX_COPYABLE_FILE_BYTES = 1_000_000

function ToggleButton(props: {
    label: string
    active: boolean
    onClick: () => void
    testId?: string
    title?: string
}) {
    return (
        <button
            type="button"
            onClick={props.onClick}
            aria-pressed={props.active}
            data-testid={props.testId}
            title={props.title}
            className={`rounded px-3 py-1 text-xs font-semibold ${props.active ? 'bg-[var(--app-button)] text-[var(--app-button-text)] opacity-80' : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)]'}`}
        >
            {props.label}
        </button>
    )
}

export function FileContentToggleView(props: { content: string; path: string | null }) {
    const { content, path } = props
    const { t } = useTranslation()
    const { copied, copy } = useCopyToClipboard()
    const [wordWrap, setWordWrap] = useFileWordWrap()
    const [markdownPreview, setMarkdownPreview] = useFileMarkdownPreview()

    const isMarkdownFile = useMemo(() => (path ? isMarkdownPath(path) : false), [path])
    const renderMarkdownPreview = isMarkdownFile && markdownPreview
    const showWordWrapToggle = !renderMarkdownPreview

    const language = useMemo(
        () => (path && !renderMarkdownPreview ? resolveLanguage(path) : undefined),
        [path, renderMarkdownPreview]
    )
    const highlighted = useShikiHighlighter(renderMarkdownPreview ? '' : content, language)

    const canCopy = useMemo(
        () => content.length > 0 && new TextEncoder().encode(content).length <= MAX_COPYABLE_FILE_BYTES,
        [content]
    )

    return (
        <div className="flex flex-col gap-2">
            {isMarkdownFile || showWordWrapToggle ? (
                <div className="flex items-center gap-2">
                    <div className="flex-1" />
                    {isMarkdownFile ? (
                        <div className="flex items-center gap-1">
                            <ToggleButton
                                label={t('file.page.tab.preview')}
                                active={markdownPreview}
                                onClick={() => setMarkdownPreview(true)}
                                testId="md-preview-toggle"
                            />
                            <ToggleButton
                                label={t('file.page.tab.raw')}
                                active={!markdownPreview}
                                onClick={() => setMarkdownPreview(false)}
                                testId="md-raw-toggle"
                            />
                        </div>
                    ) : null}
                    {showWordWrapToggle ? (
                        <ToggleButton
                            label={t('file.page.wordWrap')}
                            active={wordWrap}
                            onClick={() => setWordWrap(!wordWrap)}
                            testId="word-wrap-toggle"
                            title={t('file.page.wordWrap')}
                        />
                    ) : null}
                </div>
            ) : null}

            <div className="relative">
                {canCopy ? (
                    <button
                        type="button"
                        onClick={() => copy(content)}
                        className="absolute right-2 top-2 z-10 rounded p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                        title={t('file.page.copyContent')}
                    >
                        {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                    </button>
                ) : null}
                {renderMarkdownPreview ? (
                    <div
                        data-testid="md-preview"
                        className="rounded-md border border-[var(--app-border)] bg-[var(--app-bg)] p-4 pr-8"
                    >
                        <FileMarkdownView content={content} />
                    </div>
                ) : (
                    <pre
                        data-testid="file-raw-pre"
                        data-word-wrap={wordWrap ? 'on' : 'off'}
                        className={`shiki rounded-md bg-[var(--app-code-bg)] p-3 pr-8 text-xs font-mono ${wordWrap ? 'overflow-x-hidden whitespace-pre-wrap break-words' : 'overflow-auto'}`}
                    >
                        <code>{highlighted ?? content}</code>
                    </pre>
                )}
            </div>
        </div>
    )
}
