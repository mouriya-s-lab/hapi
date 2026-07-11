import { describe, expect, it } from 'vitest'
import { isPreviewableGeneratedFileMimeType } from './ToolMessage'

describe('generated file preview safety', () => {
    it('allows inert document and media formats', () => {
        expect(isPreviewableGeneratedFileMimeType('text/plain')).toBe(true)
        expect(isPreviewableGeneratedFileMimeType('text/markdown')).toBe(true)
        expect(isPreviewableGeneratedFileMimeType('application/json')).toBe(true)
        expect(isPreviewableGeneratedFileMimeType('application/pdf')).toBe(true)
        expect(isPreviewableGeneratedFileMimeType('image/png')).toBe(true)
        expect(isPreviewableGeneratedFileMimeType('video/mp4')).toBe(true)
    })

    it('never opens active HTML, XML, SVG, or script formats as same-origin blobs', () => {
        expect(isPreviewableGeneratedFileMimeType('text/html')).toBe(false)
        expect(isPreviewableGeneratedFileMimeType('application/xhtml+xml')).toBe(false)
        expect(isPreviewableGeneratedFileMimeType('application/xml')).toBe(false)
        expect(isPreviewableGeneratedFileMimeType('image/svg+xml')).toBe(false)
        expect(isPreviewableGeneratedFileMimeType('text/javascript')).toBe(false)
    })
})
