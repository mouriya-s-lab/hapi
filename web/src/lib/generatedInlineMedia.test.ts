import { describe, expect, it } from 'vitest'
import { inlineMediaLabelKey, isInlineAudioMimeType, isInlineVideoMimeType } from './generatedInlineMedia'

describe('generatedInlineMedia', () => {
    it('detects inline video MIME types', () => {
        expect(isInlineVideoMimeType('video/mp4')).toBe(true)
        expect(isInlineVideoMimeType('video/webm')).toBe(true)
        expect(isInlineVideoMimeType('image/png')).toBe(false)
        expect(isInlineVideoMimeType(null)).toBe(false)
    })

    it('selects the localized displayed-media label by MIME type', () => {
        expect(inlineMediaLabelKey('video/mp4')).toBe('media.displayed.video')
        expect(inlineMediaLabelKey('image/png')).toBe('media.displayed.image')
        expect(inlineMediaLabelKey('audio/wav')).toBe('media.displayed.audio')
        expect(inlineMediaLabelKey('application/octet-stream')).toBe('media.displayed.file')
        expect(inlineMediaLabelKey(null)).toBe('media.displayed.image')
        expect(isInlineAudioMimeType('audio/mpeg')).toBe(true)
    })
})
