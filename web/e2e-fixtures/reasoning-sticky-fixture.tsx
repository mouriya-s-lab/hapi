import React from 'react'
import ReactDOM from 'react-dom/client'
import { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react'
import '../src/index.css'
import { Reasoning, ReasoningGroup } from '../src/components/assistant-ui/reasoning'
import { CodeBlock } from '../src/components/CodeBlock'
import { UserBubbleContent } from '../src/components/AssistantChat/messages/user-bubble'
import { I18nProvider } from '../src/lib/i18n-context'

const longText = Array.from({ length: 80 }, (_, index) => `Reasoning paragraph ${index + 1}.`).join('\n\n')
const messages: ThreadMessageLike[] = [{
    id: 'reasoning-message',
    role: 'assistant',
    content: [{ type: 'reasoning', text: longText }],
    status: { type: 'complete', reason: 'stop' }
}]

function AssistantMessage() {
    return (
        <MessagePrimitive.Root>
            <MessagePrimitive.Content components={{ Reasoning, ReasoningGroup }} />
        </MessagePrimitive.Root>
    )
}

function App() {
    const runtime = useExternalStoreRuntime({
        messages,
        convertMessage: (message): ThreadMessageLike => message,
        onNew: async () => {}
    })
    const expansion = new URLSearchParams(window.location.search).get('expansion')
    const content = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`).join('\n')

    return (
        <I18nProvider>
            {expansion ? (
                <main className="p-6" data-testid="expansion-host">
                    {expansion === 'code' ? (
                        <CodeBlock code={content} language="text" collapseLongContent />
                    ) : (
                        <>
                            <UserBubbleContent text={content} />
                            <div data-testid="short-content"><UserBubbleContent text="short" /></div>
                        </>
                    )}
                </main>
            ) : (
                <AssistantRuntimeProvider runtime={runtime}>
                    <ThreadPrimitive.Root>
                        <main className="h-screen overflow-y-auto p-6" data-testid="scroll-viewport">
                            <div className="h-[700px]" />
                            <ThreadPrimitive.Messages components={{ AssistantMessage }} />
                            <div className="h-[700px]" />
                        </main>
                    </ThreadPrimitive.Root>
                </AssistantRuntimeProvider>
            )}
        </I18nProvider>
    )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
