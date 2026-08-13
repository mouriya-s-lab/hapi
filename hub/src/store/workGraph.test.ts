import { describe, expect, it } from 'bun:test'
import { WORK_GRAPH_MAX_SUMMARY } from '@hapi/protocol'
import { Store, WorkGraphPrincipalError, WorkGraphValidationError } from './index'

const humanPrincipal = { kind: 'human' as const, id: '1' }

describe('WorkGraphStore', () => {
    it('refuses non-human principal without human owner', () => {
        const store = new Store(':memory:')
        expect(() => store.workGraph.insertEvent('default', {
            source_kind: 'session',
            source_ref: 'sess-a',
            event_type: 'work_ad',
            summary: 'no owner',
            // Passes Zod min(1) but fails trim accountability (store choke point).
            principal: { kind: 'agent', id: 'worker', on_behalf_of: '   ' }
        })).toThrow(WorkGraphPrincipalError)
    })

    it('rejects summary longer than WORK_GRAPH_MAX_SUMMARY at insert (S4)', () => {
        const store = new Store(':memory:')
        const oversized = 'x'.repeat(WORK_GRAPH_MAX_SUMMARY + 1)
        expect(() => store.workGraph.insertEvent('default', {
            source_kind: 'session',
            source_ref: 'sess-a',
            event_type: 'work_ad',
            summary: oversized,
            principal: humanPrincipal
        })).toThrow(WorkGraphValidationError)
        expect(store.workGraph.listByRelatedSession('default', 'sess-a')).toHaveLength(0)
    })

    it('isolates writes and queries by namespace', () => {
        const store = new Store(':memory:')
        const alpha = store.workGraph.insertEvent('alpha', {
            source_kind: 'session',
            source_ref: 'sess-a',
            event_type: 'work_ad',
            related_session_id: 'sess-a',
            summary: 'alpha ad',
            principal: humanPrincipal
        })
        store.workGraph.insertEvent('beta', {
            source_kind: 'session',
            source_ref: 'sess-b',
            event_type: 'work_ad',
            related_session_id: 'sess-a',
            summary: 'beta ad same related id',
            principal: humanPrincipal
        })

        expect(store.workGraph.getEvent(alpha.event.id, 'beta')).toBeNull()
        expect(store.workGraph.getEvent(alpha.event.id, 'alpha')?.summary).toBe('alpha ad')

        const alphaRows = store.workGraph.listByRelatedSession('alpha', 'sess-a')
        expect(alphaRows).toHaveLength(1)
        expect(alphaRows[0]?.summary).toBe('alpha ad')

        const betaRows = store.workGraph.listByRelatedSession('beta', 'sess-a')
        expect(betaRows).toHaveLength(1)
        expect(betaRows[0]?.summary).toBe('beta ad same related id')
    })

    it('idempotent insert via idempotency_key does not duplicate', () => {
        const store = new Store(':memory:')
        const first = store.workGraph.insertEvent('default', {
            source_kind: 'session',
            source_ref: 'sess-a',
            event_type: 'work_ad',
            related_session_id: 'sess-a',
            summary: 'first',
            idempotency_key: 'key-1',
            principal: humanPrincipal
        })
        const second = store.workGraph.insertEvent('default', {
            source_kind: 'session',
            source_ref: 'sess-a',
            event_type: 'work_ad',
            related_session_id: 'sess-a',
            summary: 'retry',
            idempotency_key: 'key-1',
            principal: humanPrincipal
        })

        expect(first.inserted).toBe(true)
        expect(second.inserted).toBe(false)
        expect(second.event.id).toBe(first.event.id)
        expect(second.event.summary).toBe('first')
        expect(store.workGraph.listByRelatedSession('default', 'sess-a')).toHaveLength(1)
    })

    it('allows same idempotency_key in different namespaces', () => {
        const store = new Store(':memory:')
        const alpha = store.workGraph.insertEvent('alpha', {
            source_kind: 'session',
            source_ref: 'a',
            event_type: 'work_ad',
            idempotency_key: 'shared-key',
            principal: humanPrincipal
        })
        const beta = store.workGraph.insertEvent('beta', {
            source_kind: 'session',
            source_ref: 'b',
            event_type: 'work_ad',
            idempotency_key: 'shared-key',
            principal: humanPrincipal
        })
        expect(alpha.inserted).toBe(true)
        expect(beta.inserted).toBe(true)
        expect(alpha.event.id).not.toBe(beta.event.id)
    })

    it('refuses cross-namespace link creation', () => {
        const store = new Store(':memory:')
        const alpha = store.workGraph.insertEvent('alpha', {
            source_kind: 'session',
            source_ref: 'a',
            event_type: 'handoff',
            principal: humanPrincipal
        })
        const beta = store.workGraph.insertEvent('beta', {
            source_kind: 'session',
            source_ref: 'b',
            event_type: 'handoff_receipt',
            principal: humanPrincipal
        })

        expect(() => store.workGraph.insertLink('alpha', {
            from_event_id: alpha.event.id,
            to_event_id: beta.event.id,
            relation_type: 'resolves'
        })).toThrow(/to_event_id not found/)
    })

    it('creates links when both endpoints are in the caller namespace', () => {
        const store = new Store(':memory:')
        const handoff = store.workGraph.insertEvent('default', {
            source_kind: 'session',
            source_ref: 'a',
            event_type: 'handoff',
            principal: humanPrincipal
        })
        const receipt = store.workGraph.insertEvent('default', {
            source_kind: 'session',
            source_ref: 'b',
            event_type: 'handoff_receipt',
            principal: humanPrincipal
        })
        const link = store.workGraph.insertLink('default', {
            from_event_id: receipt.event.id,
            to_event_id: handoff.event.id,
            relation_type: 'resolves'
        })
        expect(link.relationType).toBe('resolves')
        expect(store.workGraph.listLinksForEvent('default', handoff.event.id)).toHaveLength(1)
    })

    it('lists work_ads for a session in chronological order without the HTTP cap', () => {
        const store = new Store(':memory:')
        const first = store.workGraph.insertEvent('default', {
            source_kind: 'session',
            source_ref: 'sess-a',
            event_type: 'work_ad',
            related_session_id: 'sess-a',
            summary: 'first',
            principal: humanPrincipal
        }, { ts: 1000 })
        store.workGraph.insertEvent('default', {
            source_kind: 'session',
            source_ref: 'sess-a',
            event_type: 'handoff',
            related_session_id: 'sess-a',
            summary: 'not an ad',
            principal: humanPrincipal
        }, { ts: 1500 })
        const second = store.workGraph.insertEvent('default', {
            source_kind: 'session',
            source_ref: 'sess-a',
            event_type: 'work_ad',
            related_session_id: 'sess-a',
            summary: 'second',
            principal: humanPrincipal
        }, { ts: 2000 })

        const ads = store.workGraph.listWorkAdsByRelatedSession('default', 'sess-a')
        expect(ads.map((event) => event.id)).toEqual([first.event.id, second.event.id])
        expect(store.workGraph.listWorkAdsByRelatedSession('beta', 'sess-a')).toEqual([])
    })

    it('lists work_ads in insert order even when a later row has an older ts', () => {
        const store = new Store(':memory:')
        const first = store.workGraph.insertEvent('default', {
            source_kind: 'session',
            source_ref: 'sess-a',
            event_type: 'work_ad',
            related_session_id: 'sess-a',
            summary: 'inserted first',
            principal: humanPrincipal
        }, { ts: 5000 })
        const second = store.workGraph.insertEvent('default', {
            source_kind: 'session',
            source_ref: 'sess-a',
            event_type: 'work_ad',
            related_session_id: 'sess-a',
            summary: 'inserted second, older ts',
            principal: humanPrincipal
        }, { ts: 1000 })

        const ads = store.workGraph.listWorkAdsByRelatedSession('default', 'sess-a')
        expect(ads.map((event) => event.id)).toEqual([first.event.id, second.event.id])
    })

    it('accepts agent principal with on_behalf_of human owner', () => {
        const store = new Store(':memory:')
        const result = store.workGraph.insertEvent('default', {
            source_kind: 'session',
            source_ref: 'worker-1',
            event_type: 'work_ad',
            principal: { kind: 'agent', id: 'worker-1', on_behalf_of: '1' }
        })
        expect(result.inserted).toBe(true)
        expect(result.event.principal).toEqual({
            kind: 'agent',
            id: 'worker-1',
            on_behalf_of: '1'
        })
    })

    it('reassigns only AGENT_NOTIFY_SUMMARY rows onto the surviving session', () => {
        const store = new Store(':memory:')
        const notify = store.workGraph.insertEvent('default', {
            source_kind: 'session',
            source_ref: 'sess-old',
            event_type: 'work_ad',
            related_session_id: 'sess-old',
            summary: 'notify',
            provenance: 'AGENT_NOTIFY_SUMMARY',
            idempotency_key: 'session:sess-old:message:msg-1:notify',
            principal: { kind: 'agent', id: 'session:sess-old', on_behalf_of: '1' }
        })
        const posted = store.workGraph.insertEvent('default', {
            source_kind: 'session',
            source_ref: 'sess-old',
            event_type: 'work_ad',
            related_session_id: 'sess-old',
            summary: 'http posted',
            principal: humanPrincipal
        })

        expect(store.workGraph.reassignNotifySession('default', 'sess-old', 'sess-new')).toBe(1)

        const moved = store.workGraph.getEvent(notify.event.id, 'default')
        expect(moved?.relatedSessionId).toBe('sess-new')
        expect(moved?.sourceRef).toBe('sess-new')
        expect(moved?.idempotencyKey).toBe('session:sess-new:message:msg-1:notify')
        expect(moved?.principal).toEqual({
            kind: 'agent',
            id: 'session:sess-new',
            on_behalf_of: '1'
        })

        const untouched = store.workGraph.getEvent(posted.event.id, 'default')
        expect(untouched?.relatedSessionId).toBe('sess-old')
        expect(untouched?.sourceRef).toBe('sess-old')
    })
})
