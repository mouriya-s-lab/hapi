import { logger } from '@/ui/logger'
import { readFile, stat, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { resolve } from 'path'
import type { FileReadResponse, GeneratedFileResponse, GeneratedImageResponse } from '@hapi/protocol/apiTypes'
import { RPC_METHODS } from '@hapi/protocol/rpcMethods'
import type { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import { validatePath } from '../pathSecurity'
import { getGeneratedImage } from '../generatedImages'
import { getGeneratedFile } from '../generatedFiles'
import { getErrorMessage, rpcError } from '../rpcResponses'

interface ReadFileRequest {
    path: string
}

type ReadFileResponse = FileReadResponse

interface ReadGeneratedImageRequest {
    id: string
}

type ReadGeneratedImageResponse = GeneratedImageResponse

interface ReadGeneratedFileRequest {
    id: string
}

type ReadGeneratedFileResponse = GeneratedFileResponse

interface WriteFileRequest {
    path: string
    content: string
    expectedHash?: string | null
}

interface WriteFileResponse {
    success: boolean
    hash?: string
    error?: string
}

function isWithinPath(targetPath: string, rootPath: string): boolean {
    const normalizedTarget = process.platform === 'win32' ? targetPath.toLowerCase() : targetPath
    const normalizedRoot = process.platform === 'win32' ? rootPath.toLowerCase() : rootPath
    const rootPrefix = normalizedRoot.endsWith('/') || normalizedRoot.endsWith('\\')
        ? normalizedRoot
        : `${normalizedRoot}${process.platform === 'win32' ? '\\' : '/'}`
    return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(rootPrefix)
}

function resolveReadablePath(targetPath: string, workingDirectory: string): { valid: true; path: string } | { valid: false; error: string } {
    const workspaceValidation = validatePath(targetPath, workingDirectory)
    if (workspaceValidation.valid) {
        return { valid: true, path: resolve(workingDirectory, targetPath) }
    }

    const resolvedTarget = resolve(workingDirectory, targetPath)
    const resolvedTmp = resolve(tmpdir())
    if (isWithinPath(resolvedTarget, resolvedTmp)) {
        return { valid: true, path: resolvedTarget }
    }

    return { valid: false, error: workspaceValidation.error ?? 'Invalid file path' }
}

export function registerFileHandlers(rpcHandlerManager: RpcHandlerManager, workingDirectory: string): void {
    rpcHandlerManager.registerHandler<ReadFileRequest, ReadFileResponse>(RPC_METHODS.ReadFile, async (data) => {
        logger.debug('Read file request:', data.path)

        const resolved = resolveReadablePath(data.path, workingDirectory)
        if (!resolved.valid) {
            return rpcError(resolved.error)
        }

        try {
            const buffer = await readFile(resolved.path)
            const content = buffer.toString('base64')
            return { success: true, content }
        } catch (error) {
            logger.debug('Failed to read file:', error)
            return rpcError(getErrorMessage(error, 'Failed to read file'))
        }
    })

    rpcHandlerManager.registerHandler<ReadGeneratedImageRequest, ReadGeneratedImageResponse>(RPC_METHODS.ReadGeneratedImage, async (data) => {
        logger.debug('Read generated image request:', data.id)

        const image = getGeneratedImage(data.id)
        if (!image) {
            return rpcError('Generated image not found')
        }

        try {
            return {
                success: true,
                content: image.content.toString('base64'),
                mimeType: image.mimeType,
                fileName: image.fileName
            }
        } catch (error) {
            logger.debug('Failed to read generated image:', error)
            return rpcError(getErrorMessage(error, 'Failed to read generated image'))
        }
    })

    rpcHandlerManager.registerHandler<ReadGeneratedFileRequest, ReadGeneratedFileResponse>(RPC_METHODS.ReadGeneratedFile, async (data) => {
        logger.debug('Read generated file request:', data.id)

        const file = getGeneratedFile(data.id)
        if (!file) {
            return rpcError('Sent file not found')
        }

        try {
            const buffer = await readFile(file.snapshotPath)
            return {
                success: true,
                content: buffer.toString('base64'),
                mimeType: file.mimeType,
                fileName: file.fileName,
                size: file.size
            }
        } catch (error) {
            logger.debug('Failed to read generated file:', error)
            return rpcError(getErrorMessage(error, 'Failed to read sent file'))
        }
    })

    rpcHandlerManager.registerHandler<WriteFileRequest, WriteFileResponse>(RPC_METHODS.WriteFile, async (data) => {
        logger.debug('Write file request:', data.path)

        const validation = validatePath(data.path, workingDirectory)
        if (!validation.valid) {
            return rpcError(validation.error ?? 'Invalid file path')
        }

        try {
            if (data.expectedHash !== null && data.expectedHash !== undefined) {
                try {
                    const existingBuffer = await readFile(data.path)
                    const existingHash = createHash('sha256').update(existingBuffer).digest('hex')

                    if (existingHash !== data.expectedHash) {
                        return rpcError(`File hash mismatch. Expected: ${data.expectedHash}, Actual: ${existingHash}`)
                    }
                } catch (error) {
                    const nodeError = error as NodeJS.ErrnoException
                    if (nodeError.code !== 'ENOENT') {
                        throw error
                    }
                    return rpcError('File does not exist but hash was provided')
                }
            } else {
                try {
                    await stat(data.path)
                    return rpcError('File already exists but was expected to be new')
                } catch (error) {
                    const nodeError = error as NodeJS.ErrnoException
                    if (nodeError.code !== 'ENOENT') {
                        throw error
                    }
                }
            }

            const buffer = Buffer.from(data.content, 'base64')
            await writeFile(data.path, buffer)

            const hash = createHash('sha256').update(buffer).digest('hex')

            return { success: true, hash }
        } catch (error) {
            logger.debug('Failed to write file:', error)
            return rpcError(getErrorMessage(error, 'Failed to write file'))
        }
    })
}
