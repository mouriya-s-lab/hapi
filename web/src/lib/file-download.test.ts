import { describe, expect, it } from 'vitest'
import { decodeBase64Bytes, fileNameFromPath } from './file-download'

describe('file download helpers', () => {
    it('decodes binary base64 without treating it as text', () => {
        expect([...decodeBase64Bytes('AP+A')]).toEqual([0, 255, 128])
    })

    it.each([
        ['/workspace/report.pdf', 'report.pdf'],
        ['C:\\workspace\\report.pdf:12:4', 'report.pdf'],
        ['relative/report.pdf:12', 'report.pdf']
    ])('extracts a download name from %s', (path, expected) => {
        expect(fileNameFromPath(path)).toBe(expected)
    })
})
