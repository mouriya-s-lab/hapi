export function isInlineVideoMimeType(mimeType: string | null | undefined): boolean {
    return typeof mimeType === 'string' && mimeType.startsWith('video/')
}

export function isInlineAudioMimeType(mimeType: string | null | undefined): boolean {
    return typeof mimeType === 'string' && mimeType.startsWith('audio/')
}

export function isInlineImageMimeType(mimeType: string | null | undefined): boolean {
    return mimeType == null || mimeType.startsWith('image/')
}

export type InlineMediaLabelKey =
    | 'media.displayed.video'
    | 'media.displayed.audio'
    | 'media.displayed.image'
    | 'media.displayed.file'

export function inlineMediaLabelKey(mimeType: string | null | undefined): InlineMediaLabelKey {
    if (isInlineVideoMimeType(mimeType)) return 'media.displayed.video'
    if (isInlineAudioMimeType(mimeType)) return 'media.displayed.audio'
    if (isInlineImageMimeType(mimeType)) return 'media.displayed.image'
    return 'media.displayed.file'
}
