/**
 * 文件下载工具：把后端经 RPC 回传的 base64 内容还原为 Blob 触发浏览器下载。
 * 供文件详情页(routes/sessions/file.tsx)和正文里的文件路径链接(FilePathAnchor)共用。
 */

export function base64ToUint8Array(value: string): Uint8Array {
    const binary = atob(value)
    return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

export function downloadBlob(filename: string, bytes: Uint8Array, mimeType: string): void {
    const arrayBuffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(arrayBuffer).set(bytes)
    const blob = new Blob([arrayBuffer], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename || 'download'
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function resolveDownloadMimeType(fileName: string, imageMimeType: string | null, binaryFile: boolean): string {
    if (imageMimeType) return imageMimeType
    if (binaryFile) return 'application/octet-stream'
    const ext = fileName.split('.').pop()?.toLowerCase()
    if (ext === 'json') return 'application/json;charset=utf-8'
    if (ext === 'csv') return 'text/csv;charset=utf-8'
    if (ext === 'html') return 'text/html;charset=utf-8'
    if (ext === 'md') return 'text/markdown;charset=utf-8'
    if (ext === 'xml') return 'application/xml;charset=utf-8'
    return 'text/plain;charset=utf-8'
}

/** 从文件路径(可能含 ~// 或 Windows 盘符、行号后缀)提取纯文件名。 */
export function fileNameFromPath(path: string): string {
    const withoutLine = path.replace(/:\d+(?::\d+)?$/, '')
    const segments = withoutLine.split(/[\\/]/)
    const last = segments[segments.length - 1] ?? ''
    return last || withoutLine
}
