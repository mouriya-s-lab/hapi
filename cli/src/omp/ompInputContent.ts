import { readFile, stat } from 'node:fs/promises';
import type { AttachmentMetadata } from '@/api/types';
import type { OmpImageContent } from './rpc/types';

const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

export type PreparedOmpInput = {
    message: string;
    images?: OmpImageContent[];
    ignoredAttachments: AttachmentMetadata[];
};

export async function prepareOmpInput(
    message: string,
    attachments: AttachmentMetadata[]
): Promise<PreparedOmpInput> {
    const imageAttachments = attachments.filter((attachment) => attachment.mimeType.startsWith('image/'));
    const ignoredAttachments = attachments.filter((attachment) => !attachment.mimeType.startsWith('image/'));
    const images: OmpImageContent[] = [];

    for (const attachment of imageAttachments) {
        let metadata;
        try {
            metadata = await stat(attachment.path);
        } catch (error) {
            throw new Error(`Cannot read image attachment ${attachment.filename}`, { cause: error });
        }
        if (!metadata.isFile()) {
            throw new Error(`Image attachment is not a file: ${attachment.filename}`);
        }
        if (metadata.size > MAX_IMAGE_BYTES) {
            throw new Error(`Image attachment exceeds 50MB: ${attachment.filename}`);
        }
        let bytes: Buffer;
        try {
            bytes = await readFile(attachment.path);
        } catch (error) {
            throw new Error(`Cannot read image attachment ${attachment.filename}`, { cause: error });
        }
        images.push({
            type: 'image',
            data: bytes.toString('base64'),
            mimeType: attachment.mimeType
        });
    }

    return {
        message,
        ...(images.length > 0 ? { images } : {}),
        ignoredAttachments
    };
}

export function describeIgnoredOmpAttachments(attachments: AttachmentMetadata[]): string | null {
    if (attachments.length === 0) {
        return null;
    }
    const files = attachments
        .map((attachment) => `${attachment.filename} (${attachment.mimeType})`)
        .join(', ');
    return `OMP RPC supports image attachments only; ignored: ${files}`;
}
