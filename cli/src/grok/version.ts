import { spawn } from 'node:child_process'

export const MINIMUM_GROK_VERSION = [0, 2, 99] as const

export function parseGrokVersionJson(value: string): [number, number, number] {
    const parsed = JSON.parse(value) as { currentVersion?: unknown }
    if (typeof parsed.currentVersion !== 'string') throw new Error('grok version --json omitted currentVersion')
    const match = parsed.currentVersion.match(/^(\d+)\.(\d+)\.(\d+)\b/)
    if (!match) throw new Error(`Unrecognized Grok version: ${parsed.currentVersion}`)
    return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function assertSupportedGrokVersion(version: readonly number[]): void {
    const [major, minor, patch] = version
    const [requiredMajor, requiredMinor, requiredPatch] = MINIMUM_GROK_VERSION
    if (major < requiredMajor || (major === requiredMajor && minor < requiredMinor)
        || (major === requiredMajor && minor === requiredMinor && patch < requiredPatch)) {
        throw new Error(`Grok CLI >= ${MINIMUM_GROK_VERSION.join('.')} is required; run grok update`)
    }
}

export async function verifyGrokVersion(): Promise<void> {
    const stdout = await new Promise<string>((resolve, reject) => {
        const child = spawn('grok', ['version', '--json'], { stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''
        let error = ''
        child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { error += chunk.toString() })
        child.once('error', (error: NodeJS.ErrnoException) => {
            if (error.code === 'ENOENT') {
                reject(new Error('Grok CLI was not found in PATH; install Grok and run `grok login`'))
                return
            }
            reject(error)
        })
        child.once('exit', (code) => code === 0 ? resolve(output) : reject(new Error(error.trim() || `grok version exited ${code}`)))
    })
    assertSupportedGrokVersion(parseGrokVersionJson(stdout))
}
