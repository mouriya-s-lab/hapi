import { basename, extname, join } from 'path'
import { copyFile, mkdir, stat } from 'fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir } from 'os'

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
const MAX_GENERATED_FILE_BYTES = 50 * 1024 * 1024
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

export function detectFileMimeType(fileName: string): string {
    const ext = extname(fileName).toLowerCase()
    return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream'
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
    const info = await stat(args.path)
    if (!info.isFile()) {
        throw new Error('Path is not a regular file')
    }
    if (info.size > MAX_GENERATED_FILE_BYTES) {
        throw new Error('File is too large to send (max 50MB)')
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
    await copyFile(args.path, snapshotPath)

    const metadata: GeneratedFileMetadata = {
        id: args.id,
        fileName,
        snapshotPath,
        mimeType: detectFileMimeType(fileName),
        size: info.size,
        createdAt: Date.now()
    }
    generatedFiles.set(args.id, metadata)
    generatedFileBytes += info.size

    evictOldGeneratedFiles()

    return metadata
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
