import { describe, expect, test } from 'bun:test'
import { applyTaskTodoEvents, applyTodoMessageContent, extractTaskTodoEventsFromMessageContent } from './taskProjection'

function claudeMessage(type: 'assistant' | 'user', content: unknown[]) {
    return { role: 'agent', content: { type: 'output', data: { type, message: { role: type, content } } } }
}

function taskCreated(id: string, subject: string) {
    return claudeMessage('user', [{ type: 'tool_result', tool_use_id: `toolu_${id}`, content: `Task #${id} created successfully: ${subject}` }])
}

function taskUpdated(input: Record<string, unknown>) {
    return claudeMessage('assistant', [{ type: 'tool_use', id: 'toolu_update', name: 'TaskUpdate', input }])
}

describe('TaskCreate and TaskUpdate todo extraction', () => {
    test('extracts create results from strings and text block arrays', () => {
        expect(extractTaskTodoEventsFromMessageContent(taskCreated('3', '实现任务面板'))).toEqual([
            { kind: 'create', id: '3', subject: '实现任务面板' }
        ])
        expect(extractTaskTodoEventsFromMessageContent(claudeMessage('user', [{
            type: 'tool_result',
            content: [{ type: 'text', text: 'Task #4 created successfully: 覆盖回填' }]
        }]))).toEqual([{ kind: 'create', id: '4', subject: '覆盖回填' }])
    })

    test('extracts typed updates and ignores failures, unrelated tools, and malformed input', () => {
        expect(extractTaskTodoEventsFromMessageContent(taskUpdated({
            taskId: '3', status: 'in_progress', subject: '更新标题', activeForm: '正在更新'
        }))).toEqual([{
            kind: 'update', taskId: '3', status: 'in_progress', subject: '更新标题', activeForm: '正在更新'
        }])
        expect(extractTaskTodoEventsFromMessageContent(claudeMessage('user', [{
            type: 'tool_result', is_error: true, content: 'Task #9 created successfully: 不应出现'
        }]))).toEqual([])
        expect(extractTaskTodoEventsFromMessageContent(claudeMessage('assistant', [{
            type: 'tool_use', name: 'Bash', input: { command: 'true' }
        }]))).toEqual([])
        expect(extractTaskTodoEventsFromMessageContent(taskUpdated({ taskId: '3', status: 'unknown' }))).toEqual([
            { kind: 'update', taskId: '3', status: undefined, subject: undefined, activeForm: undefined }
        ])
    })
})

describe('Task todo state', () => {
    test('creates, updates, renames, deletes, and replays idempotently', () => {
        const created = applyTaskTodoEvents(null, [
            { kind: 'create', id: '1', subject: '第一步' },
            { kind: 'create', id: '2', subject: '第二步' }
        ])
        expect(created).toEqual([
            { id: '1', content: '第一步', status: 'pending', priority: 'medium' },
            { id: '2', content: '第二步', status: 'pending', priority: 'medium' }
        ])
        expect(applyTaskTodoEvents(created, [{ kind: 'create', id: '1', subject: '第一步' }])).toBeNull()
        expect(applyTaskTodoEvents(created, [
            { kind: 'update', taskId: '1', status: 'in_progress', subject: '第一步（新）', activeForm: '执行中' },
            { kind: 'update', taskId: '2', status: 'deleted' }
        ])).toEqual([{ id: '1', content: '第一步（新）', status: 'in_progress', priority: 'medium', activeForm: '执行中' }])
        expect(applyTaskTodoEvents(created, [{ kind: 'update', taskId: 'missing', status: 'completed' }])).toBeNull()
    })

    test('real-time application and chronological backfill produce identical state', () => {
        const messages = [
            taskCreated('1', '分析来源'),
            taskCreated('2', '重新实现'),
            taskUpdated({ taskId: '1', status: 'completed' }),
            taskUpdated({ taskId: '2', status: 'in_progress', activeForm: '正在实现' })
        ]
        const replay = (initial: ReturnType<typeof applyTodoMessageContent>) => messages.reduce(
            (todos, message) => applyTodoMessageContent(todos, message) ?? todos,
            initial
        )
        expect(replay(null)).toEqual(replay(null))
        expect(replay(null)).toEqual([
            { id: '1', content: '分析来源', status: 'completed', priority: 'medium' },
            { id: '2', content: '重新实现', status: 'in_progress', priority: 'medium', activeForm: '正在实现' }
        ])
    })
})
