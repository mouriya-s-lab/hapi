import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import '../src/index.css'
import { ReasoningGroupView } from '../src/components/assistant-ui/reasoning-group'
import { I18nProvider } from '../src/lib/i18n-context'

function App() {
    const [isOpen, setIsOpen] = useState(false)

    return (
        <I18nProvider>
            <main className="h-screen overflow-y-auto p-6" data-testid="scroll-viewport">
                <div className="h-[700px]" />
                <ReasoningGroupView
                    isOpen={isOpen}
                    isStreaming={false}
                    onToggle={() => setIsOpen((open) => !open)}
                >
                    <div className="h-[1800px]" data-testid="long-reasoning">Long reasoning</div>
                </ReasoningGroupView>
                <div className="h-[700px]" />
            </main>
        </I18nProvider>
    )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
