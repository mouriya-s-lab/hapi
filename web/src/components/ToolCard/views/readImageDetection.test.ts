import { describe, expect, it } from 'vitest'
import { detectImageDataUrl } from './readImageDetection'

// Base64 samples for detection. Only the leading magic bytes drive the mime;
// filler tail is arbitrary valid base64 to clear the ≥64-char min-length gate.
// Interior '=' is illegal, so padding only lives at the very end.
const FILLER = 'MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTIzNDU2Nzg5MDEyMzQ1Njc4OQ' // 54 chars, base64-legal
const pad = (magicPrefix: string): string => `${magicPrefix}${FILLER}${FILLER}==`
const PNG_HEAD = pad('iVBORw0KGgo')
const JPEG_HEAD = pad('/9j/')
const GIF_HEAD = pad('R0lGODlh')
const WEBP_HEAD = pad('UklGRiI')
const BMP_HEAD = pad('Qk3')

describe('detectImageDataUrl', () => {
    it('recognizes PNG base64 by magic bytes', () => {
        expect(detectImageDataUrl(PNG_HEAD, null)).toBe(`data:image/png;base64,${PNG_HEAD}`)
    })

    it('recognizes JPEG base64 by magic bytes', () => {
        expect(detectImageDataUrl(JPEG_HEAD, null)).toBe(`data:image/jpeg;base64,${JPEG_HEAD}`)
    })

    it('recognizes GIF / WebP / BMP base64 by magic bytes', () => {
        expect(detectImageDataUrl(GIF_HEAD, null)).toBe(`data:image/gif;base64,${GIF_HEAD}`)
        expect(detectImageDataUrl(WEBP_HEAD, null)).toBe(`data:image/webp;base64,${WEBP_HEAD}`)
        expect(detectImageDataUrl(BMP_HEAD, null)).toBe(`data:image/bmp;base64,${BMP_HEAD}`)
    })

    it('strips Read tool "N\\t" line-number prefixes before detecting', () => {
        // Split the PNG head onto three "lines" the way Read renders them.
        const chunkSize = Math.ceil(PNG_HEAD.length / 3)
        const withLineNumbers = [0, 1, 2]
            .map((i) => `${i + 1}\t${PNG_HEAD.slice(i * chunkSize, (i + 1) * chunkSize)}`)
            .join('\n')
        expect(detectImageDataUrl(withLineNumbers, null)).toBe(`data:image/png;base64,${PNG_HEAD}`)
    })

    it('passes through valid data:image URLs untouched', () => {
        const dataUrl = `data:image/png;base64,${PNG_HEAD}`
        expect(detectImageDataUrl(dataUrl, null)).toBe(dataUrl)
    })

    it('returns null for short base64 (looks like accidental base64-shaped text)', () => {
        expect(detectImageDataUrl('SGVsbG8gd29ybGQ=', null)).toBeNull() // 16 chars < 64
    })

    it('returns null for text containing non-base64 characters', () => {
        expect(detectImageDataUrl('this is regular file content, definitely not base64', null)).toBeNull()
    })

    it('returns null for empty input', () => {
        expect(detectImageDataUrl('', null)).toBeNull()
        expect(detectImageDataUrl('   \n\t  ', null)).toBeNull()
    })

    it('falls back to path extension when magic bytes are unrecognized (e.g. SVG, AVIF)', () => {
        // Long enough valid-base64 blob with no known magic prefix.
        const unknown = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWjAxMjM0NTY3ODk='
        expect(detectImageDataUrl(unknown, '/foo/bar.svg')).toBe(`data:image/svg+xml;base64,${unknown}`)
        expect(detectImageDataUrl(unknown, '/foo/bar.avif')).toBe(`data:image/avif;base64,${unknown}`)
    })

    it('returns null when magic bytes fail AND path is not an image extension', () => {
        const unknown = 'YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXpBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWjAxMjM0NTY3ODk='
        expect(detectImageDataUrl(unknown, '/foo/bar.txt')).toBeNull()
        expect(detectImageDataUrl(unknown, null)).toBeNull()
    })
})
