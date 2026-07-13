import { describe, expect, it, vi } from 'vitest'
import { GrokSessionController } from './sessionController'

describe('GrokSessionController', () => {
    it('owns fresh local identity and commits the same reserved id', () => {
        const controller = new GrokSessionController({
            control: { kind: 'local' }, permissionMode: 'default', effort: 'medium'
        })
        const reserved = controller.reserveLocalSessionId()
        expect(reserved.createSession).toBe(true)
        controller.commitSessionId(reserved.sessionId)
        expect(controller.snapshot().identity).toEqual({ kind: 'persisted', sessionId: reserved.sessionId })
        expect(controller.snapshot().effort).toEqual({ kind: 'creation-only', effortId: 'medium' })
    })

    it('does not claim the effort of an imported session', () => {
        const controller = new GrokSessionController({
            sessionId: 'persisted', control: { kind: 'local' }, permissionMode: 'default', effort: 'high'
        })
        expect(controller.snapshot().effort).toEqual({ kind: 'unknown-existing-session' })
    })

    it('commits model state only after the remote transport succeeds', async () => {
        const controller = new GrokSessionController({
            control: { kind: 'remote' }, permissionMode: 'default', effort: 'medium'
        })
        const setModel = vi.fn(async () => {})
        controller.bindRemoteModelTransport({ currentModelId: 'grok-4.5', setModel })
        await expect(controller.applyConfig({ model: 'grok-composer-2.5-fast' })).resolves.toEqual({
            applied: { model: 'grok-composer-2.5-fast', modelReasoningEffort: null }
        })
        expect(setModel).toHaveBeenCalledWith('grok-composer-2.5-fast')
        expect(controller.snapshot().model).toEqual({ kind: 'applied', modelId: 'grok-composer-2.5-fast' })
        expect(controller.snapshot().effort).toEqual({ kind: 'native-default' })
    })

    it('keeps the whole transaction unchanged when effort validation fails', async () => {
        const controller = new GrokSessionController({ control: { kind: 'remote' }, permissionMode: 'default' })
        const setModel = vi.fn(async () => {})
        controller.bindRemoteModelTransport({ currentModelId: 'grok-4.5', setModel })
        await expect(controller.applyConfig({
            permissionMode: 'yolo', model: 'grok-composer-2.5-fast', modelReasoningEffort: 'low'
        })).rejects.toThrow('only be selected when creating')
        expect(setModel).not.toHaveBeenCalled()
        expect(controller.snapshot().permissionMode).toBe('default')
        expect(controller.snapshot().model).toEqual({ kind: 'applied', modelId: 'grok-4.5' })
    })

    it('does not ACK or mutate state when Grok rejects the model', async () => {
        const controller = new GrokSessionController({ control: { kind: 'remote' }, permissionMode: 'default' })
        controller.bindRemoteModelTransport({
            currentModelId: 'grok-4.5',
            setModel: vi.fn(async () => { throw new Error('model rejected') })
        })
        await expect(controller.applyConfig({ permissionMode: 'yolo', model: 'invalid-model' }))
            .rejects.toThrow('model rejected')
        expect(controller.snapshot().permissionMode).toBe('default')
        expect(controller.snapshot().model).toEqual({ kind: 'applied', modelId: 'grok-4.5' })
    })

    it('refuses model changes when Grok did not report currentModelId', async () => {
        const controller = new GrokSessionController({ control: { kind: 'remote' }, permissionMode: 'default' })
        controller.bindRemoteModelTransport({ currentModelId: null, setModel: vi.fn() })
        await expect(controller.applyConfig({ model: 'grok-4.5' })).rejects.toThrow('did not report a current model')
    })

    it('keeps the first runtime model as Default across handoff rebinds', async () => {
        const controller = new GrokSessionController({ control: { kind: 'remote' }, permissionMode: 'default' })
        controller.bindRemoteModelTransport({ currentModelId: 'grok-4.5', setModel: vi.fn(async () => {}) })
        controller.setControl({ kind: 'local' })
        const setModel = vi.fn(async () => {})
        controller.bindRemoteModelTransport({ currentModelId: 'grok-composer-2.5-fast', setModel })
        await controller.applyConfig({ model: null })
        expect(setModel).toHaveBeenCalledWith('grok-4.5')
    })
})
