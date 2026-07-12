// Read 工具读取被 base64 编码的图片文件时，结果是一长串 base64 文本（PNG 以
// `iVBORw0KGgo` 开头、JPEG 以 `/9j/` 开头等）。Read 还会给每行加 "N\t" 行号
// 前缀，需先剥掉行号与空白，再判断是否为图片 base64，能识别就还原成 data URL。
//
// Imported (with minor rename + safety tightening) from bobmcmxciv/hapi
// commit 1a6684d5 — kept in its own file so `_results.tsx` only gains an
// import + one line of dispatch, keeping the upstream file trunk-patch light.

const IMAGE_PATH_EXTENSIONS = /\.(png|jpe?g|gif|webp|bmp|avif|svg)$/i

const IMAGE_EXT_TO_MIME: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    avif: 'image/avif',
    svg: 'image/svg+xml'
}

const MIN_BASE64_LENGTH_FOR_IMAGE = 64

function detectMimeFromMagic(stripped: string): string | null {
    if (stripped.startsWith('iVBORw0KGgo')) return 'image/png'
    if (stripped.startsWith('/9j/')) return 'image/jpeg'
    if (stripped.startsWith('R0lGOD')) return 'image/gif'
    if (stripped.startsWith('UklGR')) return 'image/webp'
    if (stripped.startsWith('Qk')) return 'image/bmp'
    return null
}

function detectMimeFromPathExtension(path: string | null): string | null {
    if (!path) return null
    const match = path.toLowerCase().match(IMAGE_PATH_EXTENSIONS)
    const ext = match?.[1]
    return ext ? (IMAGE_EXT_TO_MIME[ext] ?? null) : null
}

export function detectImageDataUrl(rawText: string, path: string | null): string | null {
    const stripped = rawText
        .replace(/^\s*\d+\t/gm, '') // 去掉 Read 的 "行号\t" 前缀
        .replace(/\s+/g, '')        // base64 不含空白，去掉换行/空格
    if (!stripped) return null

    const asDataUrl = /^data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+$/i.exec(stripped)
    if (asDataUrl) return stripped

    if (stripped.length < MIN_BASE64_LENGTH_FOR_IMAGE) return null
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(stripped)) return null

    const mime = detectMimeFromMagic(stripped) ?? detectMimeFromPathExtension(path)
    if (!mime) return null

    return `data:${mime};base64,${stripped}`
}
