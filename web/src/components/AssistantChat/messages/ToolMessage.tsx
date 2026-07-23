import { useEffect, useRef, useState } from 'react'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import type { ChatBlock } from '@/chat/types'
import type { GeneratedFileBlock, GeneratedImageBlock, ToolCallBlock } from '@/chat/types'
import { FileIcon } from '@/components/FileIcon'
import { formatFileSize } from '@/components/AssistantChat/messages/MessageAttachments'
import type { ToolGroupBlock } from '@/chat/toolGroups'
import { isObject, safeStringify } from '@hapi/protocol'
import { isSubagentToolName } from '@/chat/subagentTool'
import { ToolGroupCard } from '@/components/ToolCard/ToolGroupCard'
import { getEventPresentation } from '@/chat/presentation'
import { isEventVisibleForFlavor } from '@/fork-features/omp-product/eventVisibility'
import { CodeBlock } from '@/components/CodeBlock'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { MessageStatusIndicator } from '@/components/AssistantChat/messages/MessageStatusIndicator'
import { ToolCard } from '@/components/ToolCard/ToolCard'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import { UserBubbleContent, getUserBubbleClassName, shouldShowMessageStatus } from '@/components/AssistantChat/messages/user-bubble'
import { ImagePreview } from '@/components/ImagePreview'
import { generatedInlineMediaLabel, isInlineVideoMimeType } from '@/lib/generatedInlineMedia'

function isToolCallBlock(value: unknown): value is ToolCallBlock {
    if (!isObject(value)) return false
    if (value.kind !== 'tool-call') return false
    if (typeof value.id !== 'string') return false
    if (value.localId !== null && typeof value.localId !== 'string') return false
    if (typeof value.createdAt !== 'number') return false
    if (!Array.isArray(value.children)) return false
    if (!isObject(value.tool)) return false
    if (typeof value.tool.name !== 'string') return false
    if (!('input' in value.tool)) return false
    if (value.tool.description !== null && typeof value.tool.description !== 'string') return false
    if (value.tool.state !== 'pending' && value.tool.state !== 'running' && value.tool.state !== 'completed' && value.tool.state !== 'error') return false
    return true
}

function isToolGroupBlock(value: unknown): value is ToolGroupBlock {
    if (!isObject(value)) return false
    if (value.kind !== 'tool-group') return false
    if (typeof value.id !== 'string') return false
    if (!Array.isArray(value.tools)) return false
    return true
}

function isGeneratedImageBlock(value: unknown): value is GeneratedImageBlock {
    if (!isObject(value)) return false
    if (value.kind !== 'generated-image') return false
    if (typeof value.id !== 'string') return false
    if (typeof value.imageId !== 'string') return false
    if (typeof value.fileName !== 'string') return false
    if (value.mimeType !== null && typeof value.mimeType !== 'string') return false
    return true
}

export function GeneratedImageCard(props: { block: GeneratedImageBlock }) {
    const ctx = useHappyChatContext()
    const [objectUrl, setObjectUrl] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)
    const objectUrlRef = useRef<string | null>(null)
    const isVideo = isInlineVideoMimeType(props.block.mimeType)
    const mediaLabel = generatedInlineMediaLabel(props.block.mimeType)

    useEffect(() => {
        return () => {
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current)
                objectUrlRef.current = null
            }
        }
    }, [])

    useEffect(() => {
        let disposed = false

        if (objectUrlRef.current) {
            URL.revokeObjectURL(objectUrlRef.current)
            objectUrlRef.current = null
        }
        setObjectUrl(null)
        setError(null)
        void ctx.api.getGeneratedImageBlob(ctx.sessionId, props.block.imageId)
            .then((blob) => {
                if (disposed) return
                const nextObjectUrl = URL.createObjectURL(blob)
                objectUrlRef.current = nextObjectUrl
                setObjectUrl(nextObjectUrl)
            })
            .catch((err: unknown) => {
                if (disposed) return
                setError(err instanceof Error ? err.message : 'Failed to load inline media')
            })

        return () => {
            disposed = true
        }
    }, [ctx.api, ctx.sessionId, props.block.imageId, isVideo])

    return (
        <div className="max-w-[92%] rounded-2xl border border-[var(--app-border)] bg-[var(--app-tool-card-bg)] p-3">
            <div className="mb-2 min-w-0 truncate text-xs font-medium text-[var(--app-hint)]">
                {mediaLabel} · {props.block.fileName}
            </div>
            {objectUrl ? (
                isVideo ? (
                    <video
                        src={objectUrl}
                        controls
                        playsInline
                        className="max-h-[min(28rem,60vh)] max-w-full rounded-xl"
                    />
                ) : (
                    <ImagePreview
                        src={objectUrl}
                        fileName={props.block.fileName}
                        label={props.block.fileName}
                        buttonClassName="block max-w-full cursor-zoom-in rounded-xl text-left"
                        imageClassName="max-h-[min(28rem,60vh)] max-w-full rounded-xl object-contain"
                    />
                )
            ) : error ? (
                <div className="text-sm text-[var(--app-hint)]">
                    {mediaLabel} is unavailable. {error}
                </div>
            ) : (
                <div className="h-48 w-72 max-w-full animate-pulse rounded-xl bg-[var(--app-subtle-bg)]" />
            )}
        </div>
    )
}

function isGeneratedFileBlock(value: unknown): value is GeneratedFileBlock {
    if (!isObject(value)) return false
    if (value.kind !== 'generated-file') return false
    if (typeof value.id !== 'string') return false
    if (typeof value.fileId !== 'string') return false
    if (typeof value.fileName !== 'string') return false
    if (value.mimeType !== null && typeof value.mimeType !== 'string') return false
    if (value.size !== null && typeof value.size !== 'number') return false
    return true
}

// Browsers can render these inline in a new tab; everything else is download-only.
export function isPreviewableGeneratedFileMimeType(mimeType: string | null): boolean {
    if (!mimeType) return false
    if (mimeType === 'application/pdf' || mimeType === 'application/json') return true
    if (mimeType === 'text/plain' || mimeType === 'text/markdown' || mimeType === 'text/csv' || mimeType === 'text/tab-separated-values') return true
    return (mimeType.startsWith('image/') && mimeType !== 'image/svg+xml')
        || mimeType.startsWith('video/')
        || mimeType.startsWith('audio/')
}

function downloadGeneratedFile(fileName: string, blob: Blob): void {
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.click()
    URL.revokeObjectURL(url)
}

export function GeneratedFileCard(props: { block: GeneratedFileBlock }) {
    const ctx = useHappyChatContext()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const mimeType = props.block.mimeType ?? 'application/octet-stream'

    const fetchBlob = async (): Promise<Blob> => {
        setBusy(true)
        setError(null)
        try {
            return await ctx.api.getGeneratedFileBlob(ctx.sessionId, props.block.fileId)
        } finally {
            setBusy(false)
        }
    }

    const handleDownload = () => {
        void fetchBlob()
            .then((blob) => downloadGeneratedFile(props.block.fileName, blob))
            .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'Failed to download file')
            })
    }

    const handleOpen = () => {
        void fetchBlob()
            .then((blob) => {
                const typed = blob.type ? blob : new Blob([blob], { type: mimeType })
                const url = URL.createObjectURL(typed)
                window.open(url, '_blank', 'noopener')
                window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
            })
            .catch((err: unknown) => {
                setError(err instanceof Error ? err.message : 'Failed to open file')
            })
    }

    return (
        <div className="max-w-[92%] rounded-2xl border border-[var(--app-border)] bg-[var(--app-tool-card-bg)] p-3">
            <button
                type="button"
                onClick={handleDownload}
                disabled={busy}
                className="flex w-full items-center gap-3 rounded-xl text-left transition-opacity hover:opacity-80 disabled:cursor-wait disabled:opacity-60"
                aria-label={`Download ${props.block.fileName}`}
            >
                <FileIcon fileName={props.block.fileName} size={36} />
                <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[var(--app-fg)]">
                        {props.block.fileName}
                    </div>
                    <div className="text-xs text-[var(--app-hint)]">
                        {props.block.size !== null ? formatFileSize(props.block.size) : 'File'}
                        {busy ? ' · Downloading…' : ''}
                    </div>
                </div>
            </button>
            <div className="mt-2 flex items-center gap-3 text-xs">
                <button
                    type="button"
                    onClick={handleDownload}
                    disabled={busy}
                    className="font-medium text-[var(--app-link)] hover:underline disabled:opacity-60"
                >
                    Download
                </button>
                {isPreviewableGeneratedFileMimeType(props.block.mimeType) ? (
                    <button
                        type="button"
                        onClick={handleOpen}
                        disabled={busy}
                        className="font-medium text-[var(--app-link)] hover:underline disabled:opacity-60"
                    >
                        Open
                    </button>
                ) : null}
            </div>
            {error ? (
                <div className="mt-2 text-xs text-red-500">
                    File is unavailable. {error}
                </div>
            ) : null}
        </div>
    )
}

function isPendingPermissionBlock(block: ChatBlock): boolean {
    return block.kind === 'tool-call' && block.tool.permission?.status === 'pending'
}

function splitTaskChildren(block: ToolCallBlock): { pending: ChatBlock[]; rest: ChatBlock[] } {
    const pending: ChatBlock[] = []
    const rest: ChatBlock[] = []

    for (const child of block.children) {
        if (isPendingPermissionBlock(child)) {
            pending.push(child)
        } else {
            rest.push(child)
        }
    }

    return { pending, rest }
}

function HappyNestedBlockList(props: {
    blocks: ChatBlock[]
}) {
    const ctx = useHappyChatContext()

    return (
        <div className="flex flex-col gap-3">
            {props.blocks.map((block) => {
                if (block.kind === 'user-text') {
                    const status = block.status
                    const canRetry = status === 'failed' && typeof block.localId === 'string' && Boolean(ctx.onRetryMessage)
                    const onRetry = canRetry ? () => ctx.onRetryMessage!(block.localId!) : undefined
                    const showStatus = shouldShowMessageStatus(status)

                    return (
                        <div key={`user:${block.id}`} className={getUserBubbleClassName(status)}>
                            <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                    <UserBubbleContent text={block.text} />
                                </div>
                                {showStatus ? (
                                    <div className="happy-message-actions-first-line shrink-0">
                                        <MessageStatusIndicator status={status} onRetry={onRetry} />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'agent-text') {
                    return (
                        <div key={`agent:${block.id}`} className="px-1">
                            <MarkdownRenderer content={block.text} />
                        </div>
                    )
                }

                if (block.kind === 'cli-output') {
                    const alignClass = block.source === 'user' ? 'ml-auto w-full max-w-[92%]' : ''
                    return (
                        <div key={`cli:${block.id}`} className="px-1 min-w-0 max-w-full overflow-x-clip">
                            <div className={alignClass}>
                                <CliOutputBlock text={block.text} />
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'generated-image') {
                    return (
                        <div key={`generated-image:${block.id}`} className="px-1">
                            <GeneratedImageCard block={block} />
                        </div>
                    )
                }

                if (block.kind === 'generated-file') {
                    return (
                        <div key={`generated-file:${block.id}`} className="px-1">
                            <GeneratedFileCard block={block} />
                        </div>
                    )
                }

                if (block.kind === 'agent-event') {
                    if (!isEventVisibleForFlavor(block.event, ctx.metadata?.flavor)) return null
                    const presentation = getEventPresentation(block.event)
                    return (
                        <div key={`event:${block.id}`} className="py-1">
                            <div className="mx-auto w-fit max-w-[92%] px-2 text-center text-xs text-[var(--app-hint)] opacity-80">
                                <span className="inline-flex items-center gap-1">
                                    {presentation.icon ? <span aria-hidden="true">{presentation.icon}</span> : null}
                                    <span>{presentation.text}</span>
                                </span>
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'tool-call') {
                    const isTask = isSubagentToolName(block.tool.name)
                    const hideChildren = block.tool.name === 'CodexAgent'
                    const taskChildren = isTask ? splitTaskChildren(block) : null

                    return (
                        <div key={`tool:${block.id}`} className="py-1">
                            <ToolCard
                                api={ctx.api}
                                sessionId={ctx.sessionId}
                                metadata={ctx.metadata}
                                terminalToolDisplayMode={ctx.terminalToolDisplayMode}
                                disabled={ctx.disabled}
                                onDone={ctx.onRefresh}
                                block={block}
                            />
                            {!hideChildren && block.children.length > 0 ? (
                                isTask ? (
                                    <>
                                        {taskChildren && taskChildren.pending.length > 0 ? (
                                            <div className="mt-2 pl-3">
                                                <HappyNestedBlockList blocks={taskChildren.pending} />
                                            </div>
                                        ) : null}
                                        {taskChildren && taskChildren.rest.length > 0 ? (
                                            <details className="mt-2">
                                                <summary className="sticky top-0 z-10 cursor-pointer bg-[var(--app-bg)] py-1 text-xs text-[var(--app-hint)]">
                                                    Task details ({taskChildren.rest.length})
                                                </summary>
                                                <div className="mt-2 pl-3">
                                                    <HappyNestedBlockList blocks={taskChildren.rest} />
                                                </div>
                                            </details>
                                        ) : null}
                                    </>
                                ) : (
                                    <div className="mt-2 pl-3">
                                        <HappyNestedBlockList blocks={block.children} />
                                    </div>
                                )
                            ) : null}
                        </div>
                    )
                }

                return null
            })}
        </div>
    )
}

export function HappyToolMessage(props: ToolCallMessagePartProps) {
    const ctx = useHappyChatContext()
    const artifact = props.artifact

    if (isToolGroupBlock(artifact)) {
        return (
            <div className="py-1 min-w-0 max-w-full overflow-x-clip">
                <ToolGroupCard
                    block={artifact}
                    metadata={ctx.metadata}
                />
            </div>
        )
    }

    if (isGeneratedImageBlock(artifact)) {
        return (
            <div className="py-1 min-w-0 max-w-full overflow-x-clip">
                <GeneratedImageCard block={artifact} />
            </div>
        )
    }

    if (isGeneratedFileBlock(artifact)) {
        return (
            <div className="py-1 min-w-0 max-w-full overflow-x-clip">
                <GeneratedFileCard block={artifact} />
            </div>
        )
    }

    if (!isToolCallBlock(artifact)) {
        const argsText = typeof props.argsText === 'string' ? props.argsText.trim() : ''
        const hasArgsText = argsText.length > 0
        const hasResult = props.result !== undefined
        const resultText = hasResult ? safeStringify(props.result) : ''

        return (
            <div className="py-1 min-w-0 max-w-full overflow-x-clip">
                <div className="overflow-clip rounded-[20px] bg-[var(--app-tool-card-bg)] p-3 shadow-none">
                    <div className="flex items-center gap-2 text-xs">
                        <div className="font-mono text-[var(--app-tool-card-accent)]">
                            Tool: {props.toolName}
                        </div>
                        {props.isError ? (
                            <span className="text-red-500">Error</span>
                        ) : null}
                        {props.status.type === 'running' && !hasResult ? (
                            <span className="text-[var(--app-hint)]">Running…</span>
                        ) : null}
                    </div>

                    {hasArgsText ? (
                        <div className="mt-2">
                            <CodeBlock code={argsText} language="json" title="Input" collapseLongContent />
                        </div>
                    ) : null}

                    {hasResult ? (
                        <div className="mt-2">
                            <CodeBlock code={resultText} language={typeof props.result === 'string' ? 'text' : 'json'} title="Output" collapseLongContent />
                        </div>
                    ) : null}
                </div>
            </div>
        )
    }

    const block = artifact
    const isTask = isSubagentToolName(block.tool.name)
    const hideChildren = block.tool.name === 'CodexAgent'
    const taskChildren = isTask ? splitTaskChildren(block) : null

    return (
        <div className="py-1 min-w-0 max-w-full overflow-x-clip">
            <ToolCard
                api={ctx.api}
                sessionId={ctx.sessionId}
                metadata={ctx.metadata}
                terminalToolDisplayMode={ctx.terminalToolDisplayMode}
                disabled={ctx.disabled}
                onDone={ctx.onRefresh}
                block={block}
            />
            {!hideChildren && block.children.length > 0 ? (
                isTask ? (
                    <>
                        {taskChildren && taskChildren.pending.length > 0 ? (
                            <div className="mt-2 pl-3">
                                <HappyNestedBlockList blocks={taskChildren.pending} />
                            </div>
                        ) : null}
                        {taskChildren && taskChildren.rest.length > 0 ? (
                            <details className="mt-2">
                                <summary className="sticky top-0 z-10 cursor-pointer bg-[var(--app-bg)] py-1 text-xs text-[var(--app-hint)]">
                                    Task details ({taskChildren.rest.length})
                                </summary>
                                <div className="mt-2 pl-3">
                                    <HappyNestedBlockList blocks={taskChildren.rest} />
                                </div>
                            </details>
                        ) : null}
                    </>
                ) : (
                    <div className="mt-2 pl-3">
                        <HappyNestedBlockList blocks={block.children} />
                    </div>
                )
            ) : null}
        </div>
    )
}
