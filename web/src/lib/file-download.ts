export function decodeBase64Bytes(value: string): Uint8Array {
    const binary = atob(value)
    return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function fileNameFromPath(path: string): string {
    const withoutLocation = path.replace(/:\d+(?::\d+)?$/, '')
    const segments = withoutLocation.split(/[\\/]/)
    return segments.at(-1) || withoutLocation
}

export function downloadBase64File(fileName: string, content: string, mimeType: string | null): void {
    const bytes = decodeBase64Bytes(content)
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    const blob = new Blob([buffer], {
        type: mimeType ?? 'application/octet-stream'
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
}
