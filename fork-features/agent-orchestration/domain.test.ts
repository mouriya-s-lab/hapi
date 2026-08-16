import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DecryptedMessage, Session } from '@hapi/protocol'
import {
    deriveAgentStatus,
    isDirectoryInAgentScope,
    isSessionInAgentScope,
    projectAgentMessage,
    projectAgentMessages,
    toAgentSessionDetails
} from './domain'

function session(
    id: string,
    path: string,
    options: {
        active?: boolean
        thinking?: boolean
        machineId?: string
        basePath?: string
        requests?: Record<string, { tool: string; arguments: unknown }>
        completedRequests?: Record<string, {
            tool: string
            arguments: unknown
            status: 'canceled' | 'denied' | 'approved'
        }>
    } = {}
): Session {
    return {
        id,
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 2,
        active: options.active ?? true,
        activeAt: 2,
        metadata: {
            path,
            host: 'localhost',
            machineId: options.machineId ?? 'machine-1',
            name: id,
            flavor: 'claude',
            tools: ['large-tool-list'],
            slashCommands: ['large-command-list'],
            ...(options.basePath ? {
                worktree: {
                    basePath: options.basePath,
                    branch: `branch-${id}`,
                    name: id
                }
            } : {})
        },
        metadataVersion: 1,
        agentState: {
            requests: options.requests ?? {},
            completedRequests: options.completedRequests ?? {}
        },
        agentStateVersion: 1,
        thinking: options.thinking ?? false,
        thinkingAt: 2,
        model: 'claude-sonnet',
        modelReasoningEffort: null,
        effort: null,
        serviceTier: null,
        resumeWithSessionModel: false,
        permissionMode: 'default'
    }
}

function message(seq: number, content: unknown): DecryptedMessage {
    return {
        id: `message-${seq}`,
        seq,
        localId: null,
        content,
        createdAt: seq
    }
}

describe('agent orchestration scope', () => {
    test('allows same, ancestor, descendant, and shared worktree roots symmetrically', () => {
        const root = session('root', '/repo')
        const child = session('child', '/repo/sub')
        const siblingWorktree = session('sibling', '/worktrees/feature', { basePath: '/repo' })
        const baseWithRoot = session('base', '/repo', { basePath: '/repo' })

        expect(isSessionInAgentScope(root, child)).toBe(true)
        expect(isSessionInAgentScope(child, root)).toBe(true)
        expect(isSessionInAgentScope(baseWithRoot, siblingWorktree)).toBe(true)
        expect(isSessionInAgentScope(siblingWorktree, baseWithRoot)).toBe(true)
        expect(isDirectoryInAgentScope(child, '/repo')).toBe(true)
    })

    test('canonicalizes symlinked paths before comparing scope', () => {
        const root = mkdtempSync(join(tmpdir(), 'hapi-agent-scope-'))
        const realRepository = join(root, 'real-repo')
        const linkedRepository = join(root, 'linked-repo')
        mkdirSync(join(realRepository, 'sub'), { recursive: true })
        symlinkSync(realRepository, linkedRepository)
        try {
            expect(isSessionInAgentScope(
                session('real', realRepository),
                session('linked', join(linkedRepository, 'sub'))
            )).toBe(true)
        } finally {
            rmSync(root, { recursive: true, force: true })
        }
    })

    test('rejects prefix traps, unrelated roots, relative paths, and other machines', () => {
        const caller = session('caller', '/repo')
        expect(isSessionInAgentScope(caller, session('prefix', '/repository'))).toBe(false)
        expect(isSessionInAgentScope(caller, session('other', '/other'))).toBe(false)
        expect(isSessionInAgentScope(caller, session('remote', '/repo/sub', { machineId: 'machine-2' }))).toBe(false)
        expect(isDirectoryInAgentScope(caller, '../repo')).toBe(false)
    })
})

describe('agent orchestration status', () => {
    test('uses dead, blocked, working, idle priority', () => {
        const request = { req: { tool: 'Bash', arguments: { command: 'date' } } }
        expect(deriveAgentStatus(session('dead', '/repo', { active: false, thinking: true, requests: request }))).toBe('dead')
        expect(deriveAgentStatus(session('blocked', '/repo', { thinking: true, requests: request }))).toBe('blocked')
        expect(deriveAgentStatus(session('working', '/repo', { thinking: true }))).toBe('working')
        expect(deriveAgentStatus(session('idle', '/repo'))).toBe('idle')
    })

    test('does not count completed requests as blocked', () => {
        const request = { req: { tool: 'Bash', arguments: { command: 'date' } } }
        const completed = { req: { ...request.req, status: 'approved' as const } }
        expect(deriveAgentStatus(session('done', '/repo', { requests: request, completedRequests: completed }))).toBe('idle')
    })
})

describe('agent message projection', () => {
    test('normalizes user, assistant, and tool records without storage envelopes', () => {
        const user = projectAgentMessage(message(1, {
            role: 'user',
            content: { type: 'text', text: 'hello' },
            meta: { sentFrom: 'webapp', fromSessionId: 'caller' },
            uuid: 'hidden'
        }))
        const assistant = projectAgentMessage(message(2, {
            role: 'agent',
            content: { type: 'codex', data: { type: 'message', message: 'PONG', usage: { total: 1 } } }
        }))
        const tool = projectAgentMessage(message(3, {
            role: 'agent',
            content: { type: 'codex', data: { type: 'tool-call', name: 'Bash', input: { cmd: 'date' } } }
        }))

        expect(user).toEqual({
            seq: 1,
            createdAt: 1,
            kind: 'user',
            text: 'hello',
            sentFrom: 'webapp',
            fromSessionId: 'caller'
        })
        expect(assistant).toEqual({ seq: 2, createdAt: 2, kind: 'assistant', text: 'PONG' })
        expect(tool).toEqual({ seq: 3, createdAt: 3, kind: 'tool', name: 'Bash', summary: '{"cmd":"date"}' })
        expect(JSON.stringify([user, assistant, tool])).not.toContain('uuid')
        expect(JSON.stringify([user, assistant, tool])).not.toContain('usage')
    })

    test('filters telemetry, compact, meta, and sidechain records while preserving page cursors', () => {
        const response = projectAgentMessages({
            messages: [
                message(1, { role: 'agent', content: { type: 'output', data: { type: 'system', subtype: 'turn_duration' } } }),
                message(2, { role: 'agent', content: { type: 'output', data: { type: 'assistant', isMeta: true } } }),
                message(3, { role: 'agent', content: { type: 'output', data: { type: 'assistant', isCompactSummary: true } } }),
                message(4, { role: 'agent', content: { type: 'output', data: { type: 'assistant', isSidechain: true } } }),
                message(5, { role: 'agent', content: { type: 'codex', data: { type: 'message', message: 'visible' } } })
            ],
            page: {
                direction: 'latest',
                limit: 5,
                epoch: 0,
                reset: false,
                nextBeforeSeq: 1,
                nextBeforeAt: 1,
                nextAfterSeq: 5,
                nextAfterAt: 5,
                snapshotHeadSeq: 5,
                snapshotHeadAt: 5,
                hasMore: true
            }
        })

        expect(response.messages).toEqual([{ seq: 5, createdAt: 5, kind: 'assistant', text: 'visible' }])
        expect(response.page.nextBeforeSeq).toBe(1)
        expect(response.page.hasMore).toBe(true)
    })
})

test('agent details stay low-noise and summarize only the pending request', () => {
    const details = toAgentSessionDetails(session('blocked', '/repo', {
        requests: { req: { tool: 'Bash', arguments: { command: 'echo hello' } } }
    }))
    expect(details).toMatchObject({
        id: 'blocked',
        status: 'blocked',
        pendingRequest: { tool: 'Bash', summary: '{"command":"echo hello"}' }
    })
    expect(details).not.toHaveProperty('metadata')
    expect(details).not.toHaveProperty('agentState')
    expect(JSON.stringify(details)).not.toContain('slashCommands')
})
