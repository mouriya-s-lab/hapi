import { basename, extname, join } from 'path'
import { copyFile, lstat, mkdir, open, rm } from 'fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir } from 'os'
import { MAX_SOCKET_RPC_BINARY_BYTES } from '@hapi/protocol/socketLimits'
import { detectImageMimeType, detectVideoMimeType } from './generatedImages'

export type GeneratedFileMetadata = {
    id: string
    fileName: string
    snapshotPath: string
    mimeType: string
    size: number
    createdAt: number
}

// Files are snapshotted to disk (not held in memory like generated images) because they
// can be much larger; the snapshot keeps IM semantics: the user downloads the bytes as
// they were when the agent sent the file, even if the original is edited or deleted.
export const MAX_GENERATED_FILE_BYTES = MAX_SOCKET_RPC_BINARY_BYTES
const MAX_GENERATED_FILE_TOTAL_BYTES = 500 * 1024 * 1024
const MAX_GENERATED_FILE_COUNT = 100

const SENT_FILES_DIR_NAME = 'hapi-sent-files'

const generatedFiles = new Map<string, GeneratedFileMetadata>()
let generatedFileBytes = 0
let cleanupRegistered = false

const MIME_BY_EXTENSION: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.tar': 'application/x-tar',
    '.gz': 'application/gzip',
    '.tgz': 'application/gzip',
    '.7z': 'application/x-7z-compressed',
    '.rar': 'application/vnd.rar',
    '.txt': 'text/plain',
    '.log': 'text/plain',
    '.md': 'text/markdown',
    '.json': 'application/json',
    '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values',
    '.html': 'text/html',
    '.htm': 'text/html',
    '.xml': 'application/xml',
    '.yaml': 'text/yaml',
    '.yml': 'text/yaml',
    '.js': 'text/javascript',
    '.ts': 'text/plain',
    '.py': 'text/x-python',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.ppt': 'application/vnd.ms-powerpoint',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.epub': 'application/epub+zip'
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
    return String.fromCharCode(...bytes.subarray(start, end))
}

function isUtf8Text(bytes: Uint8Array): boolean {
    if (bytes.includes(0)) return false
    try {
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
        return true
    } catch {
        return false
    }
}

export function detectFileMimeType(fileName: string, bytes?: Uint8Array): string {
    const ext = extname(fileName).toLowerCase()
    if (bytes !== undefined) {
        if (bytes.length === 0) return 'text/plain'
        const image = detectImageMimeType(bytes)
        if (image) return image
        const video = detectVideoMimeType(bytes)
        if (video) return video

        if (bytes.length >= 5 && ascii(bytes, 0, 5) === '%PDF-') return 'application/pdf'
        if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'PK\x03\x04') {
            if (ext === '.docx') return MIME_BY_EXTENSION['.docx']
            if (ext === '.xlsx') return MIME_BY_EXTENSION['.xlsx']
            if (ext === '.pptx') return MIME_BY_EXTENSION['.pptx']
            if (ext === '.epub') return MIME_BY_EXTENSION['.epub']
            return 'application/zip'
        }
        if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return 'application/gzip'
        if (bytes.length >= 6 && ascii(bytes, 0, 6) === '7z\xbc\xaf\x27\x1c') return 'application/x-7z-compressed'
        if (bytes.length >= 7 && (ascii(bytes, 0, 7) === 'Rar!\x1a\x07\x00' || ascii(bytes, 0, 7) === 'Rar!\x1a\x07\x01')) return 'application/vnd.rar'
        if (bytes.length >= 8
            && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0
            && bytes[4] === 0xa1 && bytes[5] === 0xb1 && bytes[6] === 0x1a && bytes[7] === 0xe1) {
            if (ext === '.doc' || ext === '.xls' || ext === '.ppt') return MIME_BY_EXTENSION[ext]
            return 'application/x-ole-storage'
        }
        if (bytes.length >= 262 && ascii(bytes, 257, 262) === 'ustar') return 'application/x-tar'
        if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'RIFF') {
            if (bytes.length >= 12 && ascii(bytes, 8, 12) === 'WAVE') return 'audio/wav'
        }
        if (bytes.length >= 3 && ascii(bytes, 0, 3) === 'ID3') return 'audio/mpeg'

        if (isUtf8Text(bytes)) {
            const text = new TextDecoder().decode(bytes).trimStart().toLowerCase()
            if (text.startsWith('<!doctype html') || text.startsWith('<html')) return 'text/html'
            if (text.startsWith('<?xml')) return ext === '.svg' ? 'image/svg+xml' : 'application/xml'
            if (ext === '.json' && (text.startsWith('{') || text.startsWith('['))) return 'application/json'
            const textMime = MIME_BY_EXTENSION[ext]
            return textMime?.startsWith('text/') ? textMime : 'text/plain'
        }

        return 'application/octet-stream'
    }
    return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream'
}

async function readFileHeader(path: string, size: number): Promise<Buffer> {
    const handle = await open(path, 'r')
    try {
        const header = Buffer.alloc(Math.min(size, 8192))
        const { bytesRead } = await handle.read(header, 0, header.length, 0)
        return header.subarray(0, bytesRead)
    } finally {
        await handle.close()
    }
}

function getSentFilesDir(): string {
    return join(tmpdir(), SENT_FILES_DIR_NAME, `${process.pid}`)
}

function sanitizeFileName(fileName: string): string {
    const sanitized = fileName
        .replace(/[/\\]/g, '_')
        .replace(/\.\./g, '_')
        .replace(/\s+/g, '_')
        .slice(0, 255)
    return sanitized || 'file'
}

function cleanupSentFilesSync(): void {
    generatedFiles.clear()
    generatedFileBytes = 0
    try {
        rmSync(getSentFilesDir(), { recursive: true, force: true })
    } catch {
        // best effort
    }
}

export async function registerGeneratedFile(args: { id: string; path: string; fileName?: string | null }): Promise<GeneratedFileMetadata> {
    const info = await lstat(args.path)
    if (!info.isFile()) {
        throw new Error('Path is not a regular file')
    }
    if (info.size > MAX_GENERATED_FILE_BYTES) {
        throw new Error(`File is too large to send (max ${MAX_GENERATED_FILE_BYTES} bytes)`)
    }

    if (!cleanupRegistered) {
        cleanupRegistered = true
        process.once('exit', cleanupSentFilesSync)
    }

    const baseName = basename(args.path) || args.id
    let fileName = sanitizeFileName(args.fileName || baseName)
    // A custom display title often omits the extension; keep the source file's
    // extension so downloads stay openable and mime detection keeps working.
    if (!extname(fileName) && extname(baseName)) {
        fileName = `${fileName}${extname(baseName)}`
    }
    const dir = getSentFilesDir()
    await mkdir(dir, { recursive: true })
    const snapshotPath = join(dir, `${args.id}-${fileName}`)
    try {
        await copyFile(args.path, snapshotPath)
        const snapshotInfo = await lstat(snapshotPath)
        if (!snapshotInfo.isFile()) {
            throw new Error('Snapshot path is not a regular file')
        }
        if (snapshotInfo.size > MAX_GENERATED_FILE_BYTES) {
            throw new Error(`File is too large to send (max ${MAX_GENERATED_FILE_BYTES} bytes)`)
        }
        const header = await readFileHeader(snapshotPath, snapshotInfo.size)

        const metadata: GeneratedFileMetadata = {
            id: args.id,
            fileName,
            snapshotPath,
            mimeType: detectFileMimeType(fileName, header),
            size: snapshotInfo.size,
            createdAt: Date.now()
        }
        generatedFiles.set(args.id, metadata)
        generatedFileBytes += snapshotInfo.size

        evictOldGeneratedFiles()

        return metadata
    } catch (error) {
        await rm(snapshotPath, { force: true })
        throw error
    }
}

function evictOldGeneratedFiles(): void {
    while (generatedFiles.size > MAX_GENERATED_FILE_COUNT || generatedFileBytes > MAX_GENERATED_FILE_TOTAL_BYTES) {
        const oldestId = generatedFiles.keys().next().value
        if (!oldestId) break
        const oldest = generatedFiles.get(oldestId)
        if (oldest) {
            generatedFileBytes -= oldest.size
            try {
                rmSync(oldest.snapshotPath, { force: true })
            } catch {
                // best effort
            }
        }
        generatedFiles.delete(oldestId)
    }
}

export function getGeneratedFile(id: string): GeneratedFileMetadata | null {
    return generatedFiles.get(id) ?? null
}

export function clearGeneratedFiles(): void {
    cleanupSentFilesSync()
}
