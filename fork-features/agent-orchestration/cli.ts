import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'
import { resolve } from 'node:path'
import { z } from 'zod'
import { configuration } from '../../cli/src/configuration'
import { getAuthToken } from '../../cli/src/api/auth'
import { buildHubRequestHeaders } from '../../cli/src/api/hubExtraHeaders'
import { initializeToken } from '../../cli/src/ui/tokenInit'
import type { CommandDefinition } from '../../cli/src/commands/types'
import {
    AgentErrorResponseSchema,
    AgentGetResponseSchema,
    AgentListResponseSchema,
    AgentReadResponseSchema,
    AgentStartResponseSchema,
    AgentStatusResponseSchema,
    AgentStatusSchema,
    type AgentErrorCode,
    type AgentStatus
} from './protocol'

const DEFAULT_HTTP_TIMEOUT_MS = 30_000

type ParsedAgentCommand =
    | { verb: 'help' }
    | { verb: 'list' }
    | { verb: 'get'; sessionId: string }
    | { verb: 'stop'; sessionId: string }
    | { verb: 'start'; directory: string; kind: string; model?: string; timeoutMs?: number }
    | { verb: 'prompt'; sessionId: string; text: string; wait: boolean; until?: AgentStatus; timeoutMs?: number }
    | { verb: 'wait'; sessionId: string; until?: AgentStatus; timeoutMs?: number }
    | {
        verb: 'read'
        sessionId: string
        limit?: number
        before?: { seq: number; at: number }
        after?: { seq: number; at: number }
        raw: boolean
    }

class AgentCliError extends Error {
    constructor(
        readonly code: AgentErrorCode,
        message: string,
        readonly exitCode = code === 'bad_args' ? 2 : 1
    ) {
        super(message)
        this.name = 'AgentCliError'
    }
}

function showAgentHelp(): void {
    console.log(`hapi agent - orchestrate scoped HAPI sessions

Usage:
  hapi agent start <dir> --kind <flavor> [--model M] [--timeout MS]
  hapi agent prompt <full-session-id> <text> [--wait] [--until STATUS] [--timeout MS]
  hapi agent wait <full-session-id> [--until STATUS] [--timeout MS]
  hapi agent read <full-session-id> [--limit N] [--before-seq S --before-at T | --after-seq S --after-at T] [--raw]
  hapi agent list
  hapi agent get <full-session-id>
  hapi agent stop <full-session-id>

STATUS: idle | working | blocked | dead
All successful commands emit one JSON object on stdout.`)
}

function requiredFlagValue(args: string[], index: number, flag: string): string {
    const value = args[index + 1]
    if (!value || value.startsWith('--')) {
        throw new AgentCliError('bad_args', `${flag} requires a value`)
    }
    return value
}

function parseInteger(value: string, flag: string, minimum = 1): number {
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < minimum) {
        throw new AgentCliError('bad_args', `${flag} must be an integer greater than or equal to ${minimum}`)
    }
    return parsed
}

function parseStatus(value: string): AgentStatus {
    const parsed = AgentStatusSchema.safeParse(value)
    if (!parsed.success) {
        throw new AgentCliError('bad_args', `invalid status '${value}'`)
    }
    return parsed.data
}

export function parseAgentCommand(args: string[]): ParsedAgentCommand {
    const [verb, ...rest] = args
    if (!verb || verb === 'help' || verb === '--help' || verb === '-h') return { verb: 'help' }

    if (verb === 'list') {
        if (rest.length > 0) throw new AgentCliError('bad_args', 'hapi agent list accepts no arguments')
        return { verb: 'list' }
    }
    if (verb === 'get' || verb === 'stop') {
        if (rest.length !== 1) throw new AgentCliError('bad_args', `hapi agent ${verb} requires one full session id`)
        return { verb, sessionId: rest[0]! }
    }
    if (verb === 'start') {
        const directory = rest[0]
        if (!directory || directory.startsWith('--')) {
            throw new AgentCliError('bad_args', 'hapi agent start requires a directory')
        }
        let kind: string | undefined
        let model: string | undefined
        let timeoutMs: number | undefined
        for (let index = 1; index < rest.length; index += 1) {
            const flag = rest[index]!
            if (flag === '--kind') {
                kind = requiredFlagValue(rest, index, flag)
                index += 1
            } else if (flag === '--model') {
                model = requiredFlagValue(rest, index, flag)
                index += 1
            } else if (flag === '--timeout') {
                timeoutMs = parseInteger(requiredFlagValue(rest, index, flag), flag)
                index += 1
            } else {
                throw new AgentCliError('bad_args', `unexpected argument: ${flag}`)
            }
        }
        if (!kind) throw new AgentCliError('bad_args', 'hapi agent start requires --kind <flavor>')
        return { verb: 'start', directory: resolve(directory), kind, ...(model ? { model } : {}), ...(timeoutMs ? { timeoutMs } : {}) }
    }
    if (verb === 'prompt') {
        const sessionId = rest[0]
        const text = rest[1]
        if (!sessionId || !text || sessionId.startsWith('--') || text.startsWith('--')) {
            throw new AgentCliError('bad_args', 'hapi agent prompt requires a full session id and text')
        }
        let wait = false
        let until: AgentStatus | undefined
        let timeoutMs: number | undefined
        for (let index = 2; index < rest.length; index += 1) {
            const flag = rest[index]!
            if (flag === '--wait') {
                wait = true
            } else if (flag === '--until') {
                until = parseStatus(requiredFlagValue(rest, index, flag))
                wait = true
                index += 1
            } else if (flag === '--timeout') {
                timeoutMs = parseInteger(requiredFlagValue(rest, index, flag), flag)
                index += 1
            } else {
                throw new AgentCliError('bad_args', `unexpected argument: ${flag}`)
            }
        }
        return { verb: 'prompt', sessionId, text, wait, ...(until ? { until } : {}), ...(timeoutMs ? { timeoutMs } : {}) }
    }
    if (verb === 'wait') {
        const sessionId = rest[0]
        if (!sessionId || sessionId.startsWith('--')) {
            throw new AgentCliError('bad_args', 'hapi agent wait requires a full session id')
        }
        let until: AgentStatus | undefined
        let timeoutMs: number | undefined
        for (let index = 1; index < rest.length; index += 1) {
            const flag = rest[index]!
            if (flag === '--until') {
                until = parseStatus(requiredFlagValue(rest, index, flag))
                index += 1
            } else if (flag === '--timeout') {
                timeoutMs = parseInteger(requiredFlagValue(rest, index, flag), flag)
                index += 1
            } else {
                throw new AgentCliError('bad_args', `unexpected argument: ${flag}`)
            }
        }
        return { verb: 'wait', sessionId, ...(until ? { until } : {}), ...(timeoutMs ? { timeoutMs } : {}) }
    }
    if (verb === 'read') {
        const sessionId = rest[0]
        if (!sessionId || sessionId.startsWith('--')) {
            throw new AgentCliError('bad_args', 'hapi agent read requires a full session id')
        }
        let limit: number | undefined
        let beforeSeq: number | undefined
        let beforeAt: number | undefined
        let afterSeq: number | undefined
        let afterAt: number | undefined
        let raw = false
        for (let index = 1; index < rest.length; index += 1) {
            const flag = rest[index]!
            if (flag === '--raw') {
                raw = true
            } else if (flag === '--limit') {
                limit = parseInteger(requiredFlagValue(rest, index, flag), flag)
                if (limit > 200) throw new AgentCliError('bad_args', '--limit must be at most 200')
                index += 1
            } else if (flag === '--before-seq') {
                beforeSeq = parseInteger(requiredFlagValue(rest, index, flag), flag)
                index += 1
            } else if (flag === '--before-at') {
                beforeAt = parseInteger(requiredFlagValue(rest, index, flag), flag, 0)
                index += 1
            } else if (flag === '--after-seq') {
                afterSeq = parseInteger(requiredFlagValue(rest, index, flag), flag)
                index += 1
            } else if (flag === '--after-at') {
                afterAt = parseInteger(requiredFlagValue(rest, index, flag), flag, 0)
                index += 1
            } else {
                throw new AgentCliError('bad_args', `unexpected argument: ${flag}`)
            }
        }
        const hasBefore = beforeSeq !== undefined || beforeAt !== undefined
        const hasAfter = afterSeq !== undefined || afterAt !== undefined
        if (hasBefore && hasAfter) throw new AgentCliError('bad_args', 'before and after cursors are mutually exclusive')
        if ((beforeSeq === undefined) !== (beforeAt === undefined)) {
            throw new AgentCliError('bad_args', '--before-seq and --before-at must be provided together')
        }
        if ((afterSeq === undefined) !== (afterAt === undefined)) {
            throw new AgentCliError('bad_args', '--after-seq and --after-at must be provided together')
        }
        return {
            verb: 'read',
            sessionId,
            ...(limit ? { limit } : {}),
            ...(beforeSeq !== undefined && beforeAt !== undefined ? { before: { seq: beforeSeq, at: beforeAt } } : {}),
            ...(afterSeq !== undefined && afterAt !== undefined ? { after: { seq: afterSeq, at: afterAt } } : {}),
            raw
        }
    }

    throw new AgentCliError('bad_args', `unknown hapi agent command '${verb}'`)
}

function resolveApiUrl(): string {
    const apiUrl = configuration.apiUrl.trim().replace(/\/+$/, '')
    if (!apiUrl) throw new AgentCliError('bad_args', 'HAPI API URL is empty')
    return apiUrl
}

function resolveCallerId(): string {
    const caller = process.env.HAPI_SESSION_ID?.trim()
    if (!caller) throw new AgentCliError('bad_args', 'HAPI_SESSION_ID is required; run this command inside a HAPI session')
    return caller
}

function requestHeaders(jwt: string): Record<string, string> {
    return buildHubRequestHeaders({
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json'
    })
}

class AgentHubClient {
    private jwt: string | null = null

    constructor(
        private readonly apiUrl: string,
        private readonly accessToken: string,
        private readonly http: AxiosInstance = axios
    ) {}

    private async getJwt(): Promise<string> {
        if (this.jwt) return this.jwt
        const response = await this.http.post(
            `${this.apiUrl}/api/auth`,
            { accessToken: this.accessToken },
            {
                headers: buildHubRequestHeaders({ 'Content-Type': 'application/json' }),
                timeout: 10_000,
                validateStatus: () => true
            }
        )
        const data: unknown = response.data
        const parsed = z.object({ token: z.string().min(1) }).safeParse(data)
        if (response.status < 200 || response.status >= 300 || !parsed.success) {
            throw new AgentCliError('auth_failed', `failed to authenticate with hub (HTTP ${response.status})`)
        }
        this.jwt = parsed.data.token
        return this.jwt
    }

    async request<T>(
        path: string,
        schema: z.ZodType<T>,
        options: { method?: 'GET' | 'POST'; data?: unknown; params?: Record<string, string | number>; timeoutMs?: number } = {}
    ): Promise<T> {
        const jwt = await this.getJwt()
        const config: AxiosRequestConfig = {
            url: `${this.apiUrl}${path}`,
            method: options.method ?? 'GET',
            headers: requestHeaders(jwt),
            data: options.data,
            params: options.params,
            timeout: options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS,
            validateStatus: () => true
        }
        let response
        try {
            response = await this.http.request(config)
        } catch (error) {
            throw new AgentCliError('internal_error', error instanceof Error ? error.message : 'Hub request failed')
        }
        const data: unknown = response.data
        if (response.status < 200 || response.status >= 300) {
            const failure = AgentErrorResponseSchema.safeParse(data)
            if (failure.success) {
                throw new AgentCliError(failure.data.error.code, failure.data.error.message)
            }
            throw new AgentCliError('internal_error', `Hub request failed with HTTP ${response.status}`)
        }
        const parsed = schema.safeParse(data)
        if (!parsed.success) {
            throw new AgentCliError('internal_error', `Hub returned an invalid response for ${path}`)
        }
        return parsed.data
    }
}

function printJson(value: unknown): void {
    console.log(JSON.stringify(value))
}

async function runAgentCommand(args: string[]): Promise<void> {
    const parsed = parseAgentCommand(args)
    if (parsed.verb === 'help') {
        showAgentHelp()
        return
    }

    await initializeToken()
    const accessToken = getAuthToken().trim()
    if (!accessToken) throw new AgentCliError('bad_args', 'CLI_API_TOKEN is required; run `hapi auth login`')
    const caller = resolveCallerId()
    const client = new AgentHubClient(resolveApiUrl(), accessToken)

    switch (parsed.verb) {
        case 'list':
            printJson(await client.request('/api/agent/sessions', AgentListResponseSchema, { params: { caller } }))
            return
        case 'get':
            printJson(await client.request(
                `/api/agent/sessions/${encodeURIComponent(parsed.sessionId)}`,
                AgentGetResponseSchema,
                { params: { caller } }
            ))
            return
        case 'stop':
            printJson(await client.request(
                `/api/agent/sessions/${encodeURIComponent(parsed.sessionId)}/stop`,
                AgentStatusResponseSchema,
                { method: 'POST', data: { caller } }
            ))
            return
        case 'start':
            printJson(await client.request('/api/agent/spawn', AgentStartResponseSchema, {
                method: 'POST',
                data: {
                    caller,
                    directory: parsed.directory,
                    agent: parsed.kind,
                    ...(parsed.model ? { model: parsed.model } : {}),
                    ...(parsed.timeoutMs ? { timeoutMs: parsed.timeoutMs } : {})
                },
                timeoutMs: (parsed.timeoutMs ?? 30_000) + 10_000
            }))
            return
        case 'prompt':
            printJson(await client.request(
                `/api/agent/sessions/${encodeURIComponent(parsed.sessionId)}/prompt`,
                AgentStatusResponseSchema,
                {
                    method: 'POST',
                    data: {
                        caller,
                        text: parsed.text,
                        wait: parsed.wait,
                        ...(parsed.until ? { until: parsed.until } : {}),
                        ...(parsed.timeoutMs ? { timeoutMs: parsed.timeoutMs } : {})
                    },
                    timeoutMs: (parsed.timeoutMs ?? 180_000) + 10_000
                }
            ))
            return
        case 'wait':
            printJson(await client.request(
                `/api/agent/sessions/${encodeURIComponent(parsed.sessionId)}/wait`,
                AgentStatusResponseSchema,
                {
                    method: 'POST',
                    data: {
                        caller,
                        ...(parsed.until ? { until: parsed.until } : {}),
                        ...(parsed.timeoutMs ? { timeoutMs: parsed.timeoutMs } : {})
                    },
                    timeoutMs: (parsed.timeoutMs ?? 180_000) + 10_000
                }
            ))
            return
        case 'read':
            printJson(await client.request(
                `/api/agent/sessions/${encodeURIComponent(parsed.sessionId)}/messages`,
                AgentReadResponseSchema,
                {
                    params: {
                        caller,
                        ...(parsed.limit ? { limit: parsed.limit } : {}),
                        ...(parsed.before ? { beforeSeq: parsed.before.seq, beforeAt: parsed.before.at } : {}),
                        ...(parsed.after ? { afterSeq: parsed.after.seq, afterAt: parsed.after.at } : {}),
                        ...(parsed.raw ? { raw: '1' } : {})
                    }
                }
            ))
            return
    }
}

export const agentCommand: CommandDefinition = {
    name: 'agent',
    requiresRuntimeAssets: false,
    run: async ({ commandArgs }) => {
        try {
            await runAgentCommand(commandArgs)
        } catch (error) {
            const failure = error instanceof AgentCliError
                ? error
                : new AgentCliError('internal_error', error instanceof Error ? error.message : 'Unknown orchestration error')
            console.error(JSON.stringify({ error: { code: failure.code, message: failure.message } }))
            process.exitCode = failure.exitCode
        }
    }
}
