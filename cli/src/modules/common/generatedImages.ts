import { randomUUID } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { asString, isObject } from '@hapi/protocol'

export type GeneratedImageMetadata = {
    id: string
    fileName: string
    content: Buffer
    mimeType: string
    createdAt: number
}

export type InlineMediaKind = 'image' | 'video'

export type InlineMediaRegistrationError = {
    code:
        | 'invalid_block'
        | 'missing_content'
        | 'invalid_uri'
        | 'remote_uri'
        | 'not_file'
        | 'too_large'
        | 'unsupported_content'
        | 'mime_mismatch'
        | 'read_failed'
    message: string
}

export type InlineMediaRegistrationResult =
    | { ok: true; media: GeneratedImageMetadata }
    | { ok: false; error: InlineMediaRegistrationError }

export const MAX_GENERATED_IMAGE_BYTES = 25 * 1024 * 1024
const MAX_GENERATED_IMAGE_TOTAL_BYTES = 100 * 1024 * 1024
const MAX_GENERATED_IMAGE_COUNT = 100

const generatedImages = new Map<string, GeneratedImageMetadata>()
let generatedImageBytes = 0
const MP4_BRANDS = new Set(['isom', 'iso2', 'mp41', 'mp42', 'M4V ', 'MSNV', 'avc1', 'dash'])

export function detectImageMimeType(bytes: Uint8Array): string | null {
    if (bytes.length >= 8
        && bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47
        && bytes[4] === 0x0d
        && bytes[5] === 0x0a
        && bytes[6] === 0x1a
        && bytes[7] === 0x0a) {
        return 'image/png'
    }

    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'image/jpeg'
    }

    if (bytes.length >= 6) {
        const header = ascii(bytes, 0, 6)
        if (header === 'GIF87a' || header === 'GIF89a') {
            return 'image/gif'
        }
    }

    if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
        return 'image/webp'
    }

    if (bytes.length >= 12
        && bytes[0] === 0x00
        && bytes[1] === 0x00
        && bytes[2] === 0x00
        && ascii(bytes, 4, 8) === 'ftyp'
        && (ascii(bytes, 8, 12) === 'avif' || ascii(bytes, 8, 12) === 'avis')) {
        return 'image/avif'
    }

    return null
}

export function detectVideoMimeType(bytes: Uint8Array): string | null {
    if (bytes.length >= 12 && ascii(bytes, 4, 8) === 'ftyp') {
        const brand = ascii(bytes, 8, 12)
        return MP4_BRANDS.has(brand) ? 'video/mp4' : null
    }

    if (bytes.length >= 4
        && bytes[0] === 0x1a
        && bytes[1] === 0x45
        && bytes[2] === 0xdf
        && bytes[3] === 0xa3) {
        return 'video/webm'
    }

    return null
}

export function isInlineMediaMimeType(mimeType: string): boolean {
    return mimeType.startsWith('image/') || mimeType.startsWith('video/')
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
    return String.fromCharCode(...bytes.subarray(start, end))
}

function detectMimeType(bytes: Uint8Array, kind: InlineMediaKind): string | null {
    return kind === 'image' ? detectImageMimeType(bytes) : detectVideoMimeType(bytes)
}

export function registerGeneratedImage(args: { id: string; path: string; mimeType: string; bytes: Uint8Array; fileName?: string | null }): GeneratedImageMetadata {
    const content = Buffer.from(args.bytes)
    if (content.byteLength > MAX_GENERATED_IMAGE_BYTES) {
        throw new Error('File is too large to display inline')
    }

    if (!isInlineMediaMimeType(args.mimeType)) {
        throw new Error('Unsupported inline media MIME type')
    }

    const previous = generatedImages.get(args.id)
    if (previous) {
        generatedImageBytes -= previous.content.byteLength
    }

    const metadata: GeneratedImageMetadata = {
        id: args.id,
        fileName: args.fileName || basename(args.path) || `${args.id}.png`,
        content,
        mimeType: args.mimeType,
        createdAt: Date.now()
    }
    generatedImages.set(args.id, metadata)
    generatedImageBytes += content.byteLength

    evictOldGeneratedImages()

    return metadata
}

function evictOldGeneratedImages(): void {
    while (generatedImages.size > MAX_GENERATED_IMAGE_COUNT || generatedImageBytes > MAX_GENERATED_IMAGE_TOTAL_BYTES) {
        const oldestId = generatedImages.keys().next().value
        if (!oldestId) break
        const oldest = generatedImages.get(oldestId)
        if (oldest) {
            generatedImageBytes -= oldest.content.byteLength
        }
        generatedImages.delete(oldestId)
    }
}

export function getGeneratedImage(id: string): GeneratedImageMetadata | null {
    return generatedImages.get(id) ?? null
}

export function unregisterGeneratedImage(id: string): void {
    const image = generatedImages.get(id)
    if (!image) return
    generatedImages.delete(id)
    generatedImageBytes -= image.content.byteLength
}

export function clearGeneratedImages(): void {
    generatedImages.clear()
    generatedImageBytes = 0
}

export async function registerGeneratedMediaFromPath(args: {
    id?: string
    path: string
    kind: InlineMediaKind
    fileName?: string | null
}): Promise<InlineMediaRegistrationResult> {
    let info
    try {
        info = await lstat(args.path)
    } catch (error) {
        return {
            ok: false,
            error: { code: 'read_failed', message: error instanceof Error ? error.message : String(error) }
        }
    }

    if (!info.isFile()) {
        return { ok: false, error: { code: 'not_file', message: 'Path is not a regular file' } }
    }
    if (info.size > MAX_GENERATED_IMAGE_BYTES) {
        return { ok: false, error: { code: 'too_large', message: 'File is too large to display inline' } }
    }

    let bytes: Buffer
    try {
        bytes = await readFile(args.path)
    } catch (error) {
        return {
            ok: false,
            error: { code: 'read_failed', message: error instanceof Error ? error.message : String(error) }
        }
    }

    const mimeType = detectMimeType(bytes, args.kind)
    if (!mimeType) {
        return {
            ok: false,
            error: {
                code: 'unsupported_content',
                message: args.kind === 'image' ? 'Unsupported image content' : 'Unsupported video content'
            }
        }
    }

    return {
        ok: true,
        media: registerGeneratedImage({
            id: args.id ?? randomUUID(),
            path: args.path,
            fileName: args.fileName,
            mimeType,
            bytes
        })
    }
}

function localPathFromAcpUri(uri: string):
    | { ok: true; path: string }
    | { ok: false; error: InlineMediaRegistrationError } {
    if (/^https?:\/\//i.test(uri)) {
        return { ok: false, error: { code: 'remote_uri', message: 'Remote ACP image URIs are not supported' } }
    }
    if (!uri.startsWith('file://')) {
        return { ok: true, path: uri }
    }
    try {
        return { ok: true, path: fileURLToPath(uri) }
    } catch {
        return { ok: false, error: { code: 'invalid_uri', message: 'Invalid ACP image file URI' } }
    }
}

function fileNameFromAcpUri(uri: string | null): string | null {
    if (!uri) return null
    if (/^https?:\/\//i.test(uri)) {
        try {
            return basename(new URL(uri).pathname) || null
        } catch {
            return null
        }
    }
    const local = localPathFromAcpUri(uri)
    return local.ok ? basename(local.path) : null
}

export async function registerGeneratedImageFromAcpBlock(block: unknown): Promise<InlineMediaRegistrationResult> {
    if (!isObject(block) || block.type !== 'image') {
        return { ok: false, error: { code: 'invalid_block', message: 'Expected an ACP image content block' } }
    }

    const data = asString(block.data)
    const declaredMimeType = asString(block.mimeType ?? block.mime_type)
    const uri = asString(block.uri ?? block.url)

    if (data) {
        const bytes = Buffer.from(data, 'base64')
        if (bytes.byteLength > MAX_GENERATED_IMAGE_BYTES) {
            return { ok: false, error: { code: 'too_large', message: 'File is too large to display inline' } }
        }
        const sniffedMimeType = detectImageMimeType(bytes)
        if (!sniffedMimeType) {
            return { ok: false, error: { code: 'unsupported_content', message: 'Unsupported image content' } }
        }
        if (declaredMimeType && declaredMimeType !== sniffedMimeType) {
            return {
                ok: false,
                error: { code: 'mime_mismatch', message: `Declared MIME ${declaredMimeType} does not match ${sniffedMimeType}` }
            }
        }
        const fileName = fileNameFromAcpUri(uri)
        return {
            ok: true,
            media: registerGeneratedImage({
                id: randomUUID(),
                path: fileName ?? 'generated-image',
                fileName,
                mimeType: sniffedMimeType,
                bytes
            })
        }
    }

    if (!uri) {
        return { ok: false, error: { code: 'missing_content', message: 'ACP image block has no data or URI' } }
    }

    const local = localPathFromAcpUri(uri)
    if (!local.ok) return local
    return await registerGeneratedMediaFromPath({
        path: local.path,
        kind: 'image',
        fileName: basename(local.path)
    })
}
