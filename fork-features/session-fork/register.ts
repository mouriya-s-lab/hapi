/**
 * Side-effect module: wires production fork providers into the registry.
 * Imported once from cli/src/index.ts at startup.
 */
import { registerForkProvider } from './providerRegistry'
import { claudeForkProvider, wireClaudeForkSpawn } from './providers/claudeFork'
import { spawnClaudeFork } from './providers/claudeForkSpawn'
import { createCodexForkProvider, type CodexForkClient } from './providers/codexFork'
import { createCodexForkClient } from './providers/codexForkClient'
import { CodexAppServerClient } from '../../cli/src/codex/codexAppServerClient'

// Claude: production spawn primitive is a one-shot child process.
wireClaudeForkSpawn(spawnClaudeFork)
registerForkProvider('claude', claudeForkProvider)

// Codex: factory makes a short-lived CodexAppServerClient per fork call.
// Mirrors the pattern in cli/src/modules/common/codexModels.ts:83-108
// (connect → initialize → call → disconnect). The provider invokes close()
// in its finally block.
async function makeShortLivedCodexForkClient(): Promise<CodexForkClient> {
    const client = new CodexAppServerClient()
    await client.connect()
    await client.initialize({
        clientInfo: { name: 'hapi-session-fork', version: '1.0.0' },
        capabilities: { experimentalApi: true }
    })
    return createCodexForkClient(client)
}

registerForkProvider('codex', createCodexForkProvider(makeShortLivedCodexForkClient))
