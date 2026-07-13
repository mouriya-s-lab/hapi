import { describe, expect, it } from 'bun:test'

const boundaryFiles = [
    '../web/routes/sessions.ts',
    '../web/routes/machines.ts',
    '../web/routes/cli.ts',
    '../web/routes/guards.ts',
    '../web/routes/grants.ts',
    '../socket/handlers/cli/index.ts',
    '../socket/server.ts',
    '../sync/messageService.ts',
    '../push/pushNotificationChannel.ts',
    '../telegram/bot.ts',
    '../sse/sseManager.ts'
] as const

describe('authorization architecture', () => {
    it('keeps production boundaries on the unified authorizer and audience resolver', async () => {
        const forbidden = /\b(resolveAccessLevel|canRead|canOperate|listReadableAccountIds|listOperableAccountIds)\b|role\s*!==?\s*['"]admin['"]/
        const violations: string[] = []
        for (const relativePath of boundaryFiles) {
            const source = await Bun.file(new URL(relativePath, import.meta.url)).text()
            if (forbidden.test(source)) violations.push(relativePath)
        }
        expect(violations).toEqual([])
    })
})
