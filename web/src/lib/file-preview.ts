import { langAlias } from '@/lib/shiki'

// Shared helpers for the fork's file-preview surfaces (issue #3 + follow-up).
//
// Both the full file-viewer route (routes/sessions/file.tsx) and the tool-card
// detail dialog (components/FileContentToggleView.tsx, used by the Read result
// view) need to decide whether a path is markdown and which Shiki language to
// highlight a raw source view with. Keeping the logic here means a single
// source of truth instead of one copy per surface.

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdown', 'mkd', 'mkdn', 'mdwn'])

function fileExtension(path: string): string | null {
    const parts = path.split('.')
    if (parts.length <= 1) return null
    const ext = parts[parts.length - 1]?.toLowerCase()
    return ext ? ext : null
}

/** True when the path's extension marks it as a markdown document. */
export function isMarkdownPath(path: string): boolean {
    const ext = fileExtension(path)
    return ext ? MARKDOWN_EXTENSIONS.has(ext) : false
}

/** Resolve a Shiki language id from a file path, or undefined when unknown. */
export function resolveLanguage(path: string): string | undefined {
    const ext = fileExtension(path)
    if (!ext) return undefined
    return langAlias[ext] ?? ext
}
