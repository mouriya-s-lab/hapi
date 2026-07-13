import { randomUUID } from 'node:crypto'
import type { PermissionMode } from './types'

export type GrokIdentity =
    | { kind: 'fresh-local'; reservedId: string }
    | { kind: 'fresh-remote' }
    | { kind: 'persisted'; sessionId: string }

export type GrokControl = { kind: 'local' } | { kind: 'remote' }

export type GrokModel =
    | { kind: 'unknown' }
    | { kind: 'applied'; modelId: string }

export type GrokEffort =
    | { kind: 'native-default' }
    | { kind: 'creation-only'; effortId: 'high' | 'medium' | 'low' }
    | { kind: 'unknown-existing-session' }

export type GrokSessionState = {
    identity: GrokIdentity
    control: GrokControl
    model: GrokModel
    effort: GrokEffort
    permissionMode: PermissionMode
}

type RemoteModelTransport = {
    currentModelId: string | null
    setModel: (modelId: string) => Promise<void>
}

export class GrokSessionController {
    private state: GrokSessionState
    private remoteModelTransport: RemoteModelTransport | null = null
    private defaultModelId: string | null = null

    constructor(input: {
        sessionId?: string
        control: GrokControl
        effort?: string | null
        permissionMode: PermissionMode
    }) {
        const identity: GrokIdentity = input.sessionId
            ? { kind: 'persisted', sessionId: input.sessionId }
            : input.control.kind === 'local'
                ? { kind: 'fresh-local', reservedId: randomUUID() }
                : { kind: 'fresh-remote' }
        const effort: GrokEffort = input.sessionId
            ? { kind: 'unknown-existing-session' }
            : input.effort
                ? { kind: 'creation-only', effortId: parseGrokEffort(input.effort) }
                : { kind: 'native-default' }
        this.state = {
            identity,
            control: input.control,
            model: { kind: 'unknown' },
            effort,
            permissionMode: input.permissionMode
        }
    }

    snapshot(): GrokSessionState {
        return structuredClone(this.state)
    }

    setControl(control: GrokControl): void {
        this.state = { ...this.state, control }
        if (control.kind === 'local') this.remoteModelTransport = null
    }

    reserveLocalSessionId(): { sessionId: string; createSession: boolean } {
        if (this.state.identity.kind === 'fresh-local') {
            return { sessionId: this.state.identity.reservedId, createSession: true }
        }
        if (this.state.identity.kind === 'persisted') {
            return { sessionId: this.state.identity.sessionId, createSession: false }
        }
        throw new Error('Remote session identity must be established before local handoff')
    }

    commitSessionId(sessionId: string): void {
        this.state = { ...this.state, identity: { kind: 'persisted', sessionId } }
    }

    bindRemoteModelTransport(transport: RemoteModelTransport): () => void {
        this.remoteModelTransport = transport
        if (this.defaultModelId === null && transport.currentModelId) {
            this.defaultModelId = transport.currentModelId
        }
        this.state = {
            ...this.state,
            control: { kind: 'remote' },
            model: transport.currentModelId ? { kind: 'applied', modelId: transport.currentModelId } : { kind: 'unknown' }
        }
        return () => {
            if (this.remoteModelTransport === transport) this.remoteModelTransport = null
        }
    }

    async applyConfig(input: {
        permissionMode?: PermissionMode
        model?: string | null
        modelReasoningEffort?: unknown
    }): Promise<{ applied: Record<string, unknown> }> {
        if (this.state.control.kind === 'local') {
            throw new Error('Grok runtime config cannot change while the local CLI controls the session')
        }
        if (input.modelReasoningEffort !== undefined) {
            throw new Error('Grok reasoning effort can only be selected when creating a new session')
        }

        const nextPermissionMode = input.permissionMode ?? this.state.permissionMode
        const requestedModelId = input.model === undefined
            ? undefined
            : input.model === null
                ? this.defaultModelId
                : input.model

        if (input.model !== undefined) {
            if (!this.remoteModelTransport || !this.remoteModelTransport.currentModelId || !requestedModelId) {
                throw new Error('Grok did not report a current model; active model switching is unavailable')
            }
            if (requestedModelId !== this.remoteModelTransport.currentModelId) {
                await this.remoteModelTransport.setModel(requestedModelId)
                this.remoteModelTransport.currentModelId = requestedModelId
            }
        }

        const applied: Record<string, unknown> = {}
        if (input.permissionMode !== undefined) applied.permissionMode = nextPermissionMode
        if (input.model !== undefined) applied.model = input.model
        const modelClearsEffort = requestedModelId !== undefined && requestedModelId !== 'grok-4.5'
        if (modelClearsEffort) applied.modelReasoningEffort = null

        this.state = {
            ...this.state,
            permissionMode: nextPermissionMode,
            model: requestedModelId ? { kind: 'applied', modelId: requestedModelId } : this.state.model,
            effort: modelClearsEffort ? { kind: 'native-default' } : this.state.effort
        }
        return { applied }
    }
}

export function parseGrokEffort(value: string): 'high' | 'medium' | 'low' {
    if (value === 'high' || value === 'medium' || value === 'low') return value
    throw new Error(`Unsupported Grok reasoning effort: ${value}`)
}
