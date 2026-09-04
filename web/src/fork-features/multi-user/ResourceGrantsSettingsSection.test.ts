import { describe, expect, it } from 'vitest'
import { buildShareTargets } from './ResourceGrantsSettingsSection'

describe('buildShareTargets', () => {
    it('builds machine, session, and directory grant targets from current resources', () => {
        expect(buildShareTargets([
            { id: 's1', metadata: { name: 'one', path: '/repo' } },
            { id: 's2', metadata: { name: 'two', worktree: { basePath: '/repo' } } }
        ], [{ id: 'm1', metadata: { displayName: 'runner' } }])).toEqual([
            { key: 'machine:m1', target: { kind: 'machine', id: 'm1', label: 'runner', description: undefined } },
            { key: 'session:s1', target: { kind: 'session', id: 's1', label: 'one', description: '/repo' } },
            { key: 'session:s2', target: { kind: 'session', id: 's2', label: 'two', description: '/repo' } },
            { key: 'directory:/repo', target: { kind: 'directory', label: '/repo', sessionIds: ['s1', 's2'] } }
        ])
    })
})
