import { describe, expect, test } from 'bun:test'
import {
    applyTaskTodoEvents,
    extractTaskTodoEventsFromMessageContent,
    extractTodoWriteTodosFromMessageContent,
} from './todos'
import type { TodoItem } from './todos'

function agentOutputMessage(data: Record<string, unknown>) {
    return {
        role: 'agent',
        content: { type: 'output', data },
    }
}

function taskCreateResultMessage(taskNumber: number, subject: string) {
    return agentOutputMessage({
        type: 'user',
        message: {
            role: 'user',
            content: [
                {
                    type: 'tool_result',
                    tool_use_id: `toolu_${taskNumber}`,
                    content: `Task #${taskNumber} created successfully: ${subject}`,
                },
            ],
        },
    })
}

function taskUpdateMessage(input: Record<string, unknown>) {
    return agentOutputMessage({
        type: 'assistant',
        message: {
            role: 'assistant',
            content: [
                { type: 'tool_use', id: 'toolu_u1', name: 'TaskUpdate', input },
            ],
        },
    })
}

describe('extractTaskTodoEventsFromMessageContent', () => {
    test('parses TaskCreate result text into a create event', () => {
        const events = extractTaskTodoEventsFromMessageContent(
            taskCreateResultMessage(3, '实现模型 ID 切换')
        )
        expect(events).toEqual([{ kind: 'create', id: '3', subject: '实现模型 ID 切换' }])
    })

    test('parses TaskCreate result delivered as text block array', () => {
        const message = agentOutputMessage({
            type: 'user',
            message: {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'toolu_1',
                        content: [{ type: 'text', text: 'Task #1 created successfully: 步骤一' }],
                    },
                ],
            },
        })
        expect(extractTaskTodoEventsFromMessageContent(message)).toEqual([
            { kind: 'create', id: '1', subject: '步骤一' },
        ])
    })

    test('parses TaskUpdate tool_use input into an update event', () => {
        const events = extractTaskTodoEventsFromMessageContent(
            taskUpdateMessage({ taskId: '2', status: 'in_progress', activeForm: '正在编译' })
        )
        expect(events).toEqual([
            { kind: 'update', taskId: '2', status: 'in_progress', subject: undefined, activeForm: '正在编译' },
        ])
    })

    test('ignores errored tool results and unrelated tools', () => {
        const errored = agentOutputMessage({
            type: 'user',
            message: {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'toolu_1',
                        is_error: true,
                        content: 'Task #9 created successfully: bogus',
                    },
                ],
            },
        })
        expect(extractTaskTodoEventsFromMessageContent(errored)).toEqual([])

        const otherTool = agentOutputMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'ls' } }],
            },
        })
        expect(extractTaskTodoEventsFromMessageContent(otherTool)).toEqual([])
    })

    test('does not collide with TodoWrite snapshot extraction', () => {
        const message = taskCreateResultMessage(1, 'x')
        expect(extractTodoWriteTodosFromMessageContent(message)).toBeNull()
    })
})

describe('applyTaskTodoEvents', () => {
    test('creates pending todos from create events', () => {
        const next = applyTaskTodoEvents(null, [
            { kind: 'create', id: '1', subject: '第一步' },
            { kind: 'create', id: '2', subject: '第二步' },
        ])
        expect(next).toEqual([
            { id: '1', content: '第一步', status: 'pending', priority: 'medium' },
            { id: '2', content: '第二步', status: 'pending', priority: 'medium' },
        ])
    })

    test('create is idempotent on replay', () => {
        const existing: TodoItem[] = [
            { id: '1', content: '第一步', status: 'in_progress', priority: 'medium' },
        ]
        expect(applyTaskTodoEvents(existing, [{ kind: 'create', id: '1', subject: '第一步' }])).toBeNull()
    })

    test('update changes status and activeForm, delete removes the item', () => {
        const existing: TodoItem[] = [
            { id: '1', content: '第一步', status: 'pending', priority: 'medium' },
            { id: '2', content: '第二步', status: 'pending', priority: 'medium' },
        ]
        const next = applyTaskTodoEvents(existing, [
            { kind: 'update', taskId: '1', status: 'in_progress', activeForm: '做第一步' },
            { kind: 'update', taskId: '2', status: 'deleted' },
        ])
        expect(next).toEqual([
            { id: '1', content: '第一步', status: 'in_progress', priority: 'medium', activeForm: '做第一步' },
        ])
    })

    test('update for unknown taskId is a no-op', () => {
        const existing: TodoItem[] = [
            { id: '1', content: '第一步', status: 'pending', priority: 'medium' },
        ]
        expect(applyTaskTodoEvents(existing, [{ kind: 'update', taskId: '99', status: 'completed' }])).toBeNull()
    })

    test('does not mutate the input array', () => {
        const existing: TodoItem[] = [
            { id: '1', content: '第一步', status: 'pending', priority: 'medium' },
        ]
        applyTaskTodoEvents(existing, [{ kind: 'update', taskId: '1', status: 'completed' }])
        expect(existing[0].status).toBe('pending')
    })
})
