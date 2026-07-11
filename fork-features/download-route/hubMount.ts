import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Context, Env, Hono } from 'hono'
import { z } from 'zod'
import { constantTimeEquals } from '../../hub/src/utils/crypto'

const DownloadRouteConfigSchema = z.object({
    token: z.string().trim().min(1),
    directory: z.string().trim().min(1)
})

const DownloadFileNameSchema = z.string().regex(/^[A-Za-z0-9._-]+$/)

type DownloadRouteConfig = z.infer<typeof DownloadRouteConfigSchema>

function downloadResponse<E extends Env>(
    context: Context<E>,
    config: DownloadRouteConfig,
    headOnly: boolean
): Response {
    if (!constantTimeEquals(context.req.param('token'), config.token)) {
        return context.text('Not found', 404)
    }

    const parsedFileName = DownloadFileNameSchema.safeParse(context.req.param('file'))
    if (!parsedFileName.success) {
        return context.text('Invalid file name', 400)
    }

    const path = join(config.directory, parsedFileName.data)
    if (!existsSync(path)) {
        return context.text('Not found', 404)
    }

    const file = Bun.file(path)
    return new Response(headOnly ? null : file, {
        headers: {
            'content-type': 'application/octet-stream',
            'content-disposition': `attachment; filename="${parsedFileName.data}"`,
            'content-length': String(file.size),
            'cache-control': 'no-cache'
        }
    })
}

export function mountDownloadRoute<E extends Env>(
    app: Hono<E>,
    input: { token?: string; directory?: string }
): void {
    const parsedConfig = DownloadRouteConfigSchema.safeParse(input)
    if (!parsedConfig.success) {
        return
    }

    app.get('/download/:token/:file', (context) => downloadResponse(context, parsedConfig.data, false))
    app.on('HEAD', '/download/:token/:file', (context) => downloadResponse(context, parsedConfig.data, true))
}
