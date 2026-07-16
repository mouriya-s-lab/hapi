/*
 * Standalone Vite-served fixture for the Mermaid pan/zoom Playwright spec.
 *
 * Mounts the REAL MermaidDiagram (which renders a real Mermaid SVG and, on
 * click, opens the fork's interactive MermaidZoomViewer overlay with pinch /
 * wheel / drag pan + zoom controls). No hub / auth / socket needed — the
 * component is self-contained given mermaid source.
 */

import React from 'react'
import ReactDOM from 'react-dom/client'
import '../src/index.css'
import { MermaidDiagram } from '../src/components/assistant-ui/mermaid-diagram'

const SAMPLE = `flowchart TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do the thing]
    B -->|No| D[Skip it]
    C --> E[Persist]
    D --> E
    E --> F[Notify]
    F --> G[End]`

function App() {
    return (
        <div style={{ padding: 24, maxWidth: 720, margin: '0 auto' }}>
            <MermaidDiagram
                code={SAMPLE}
                language="mermaid"
                components={{
                    Pre: (props) => <pre {...props} />,
                    Code: (props) => <code {...props} />,
                }}
            />
        </div>
    )
}

const rootEl = document.getElementById('root')
if (rootEl) {
    ReactDOM.createRoot(rootEl).render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    )
}
