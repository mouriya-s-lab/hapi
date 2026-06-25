import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { shareTargetPathnameFromBase } from './src/lib/sharePath'
import { execSync } from 'node:child_process'

const base = process.env.VITE_BASE_URL || '/'
const shareAction = shareTargetPathnameFromBase(base)
const hubTarget = process.env.VITE_HUB_PROXY || 'http://127.0.0.1:3006'
const appVersion = readAppVersion()

function readBaseVersion(): string {
    const buildInfoPath = resolve(__dirname, '../shared/src/buildInfo.ts')
    const buildInfo = readFileSync(buildInfoPath, 'utf8')
    const match = buildInfo.match(/export const APP_VERSION = ['"]([^'"]+)['"]/)

    if (!match) {
        throw new Error(`Could not read APP_VERSION from ${buildInfoPath}`)
    }

    return match[1]
}

// Version surfaced in Settings → About. This fork ships pinned, pre-built
// binaries tagged `vX.Y.Z-fork.N`, so the upstream base version alone (e.g.
// 0.20.0) can't tell which fork build is running. Release builds inject the
// fork tag via HAPI_FORK_VERSION (release.yml passes github.ref_name); local
// builds fall back to `git describe`, and a non-git/checkout falls back to the
// upstream base version with a `-dev` marker.
function readAppVersion(): string {
    const base = readBaseVersion()

    const fromEnv = process.env.HAPI_FORK_VERSION?.trim()
    if (fromEnv) {
        return fromEnv
    }

    try {
        const described = execSync('git describe --tags --always --dirty', {
            cwd: __dirname,
            stdio: ['ignore', 'pipe', 'ignore'],
        })
            .toString()
            .trim()
        if (described) {
            return described
        }
    } catch {
        // not a git checkout / no tags reachable — fall through to base
    }

    return `${base}-dev`
}

function getVendorChunkName(id: string): string | undefined {
    if (!id.includes('/node_modules/')) {
        return undefined
    }

    if (id.includes('/node_modules/@xterm/')) {
        return 'vendor-terminal'
    }

    if (
        id.includes('/node_modules/@assistant-ui/')
        || id.includes('/node_modules/remark-gfm/')
        || id.includes('/node_modules/hast-util-to-jsx-runtime/')
    ) {
        return 'vendor-assistant'
    }

    if (id.includes('/node_modules/@elevenlabs/react/')) {
        return 'vendor-voice'
    }

    return undefined
}

export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify(appVersion),
    },
    server: {
        host: true,
        allowedHosts: ['hapidev.weishu.me'],
        proxy: {
            '/api': {
                target: hubTarget,
                changeOrigin: true
            },
            '/socket.io': {
                target: hubTarget,
                ws: true
            }
        }
    },
    plugins: [
        react(),
        VitePWA({
            // User-controlled reload avoids mid-session surprise reloads (autoUpdate reloads all tabs).
            registerType: 'prompt',
            includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png', 'mask-icon.svg'],
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.ts',
            manifest: {
                name: 'HAPI',
                short_name: 'HAPI',
                description: 'AI-powered development assistant',
                theme_color: '#ffffff',
                background_color: '#ffffff',
                display: 'standalone',
                orientation: 'portrait',
                scope: base,
                start_url: base,
                icons: [
                    {
                        src: 'pwa-64x64.png',
                        sizes: '64x64',
                        type: 'image/png',
                        purpose: 'any'
                    },
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png',
                        purpose: 'any'
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'any'
                    }
                ],
                // Web Share Target — Android Chrome routes POSTs to /share
                // when the user picks HAPI in the system share sheet. The
                // service worker (`web/src/sw.ts`) intercepts POST /share,
                // stashes the multipart payload in IndexedDB, and 303-
                // redirects to /share?id=<transferId> for the SPA picker.
                // `*/*` is the broad fallback; explicit MIME prefixes stay
                // first because some Chrome versions only honor declared
                // prefixes when surfacing in the share sheet.
                share_target: {
                    action: shareAction,
                    method: 'POST',
                    enctype: 'multipart/form-data',
                    params: {
                        title: 'title',
                        text: 'text',
                        url: 'url',
                        files: [
                            {
                                name: 'files',
                                accept: [
                                    'image/*',
                                    'application/pdf',
                                    'text/*',
                                    'application/json',
                                    'application/zip',
                                    '*/*'
                                ]
                            }
                        ]
                    }
                }
            },
            injectManifest: {
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}']
            },
            devOptions: {
                enabled: true,
                type: 'module'
            }
        })
    ],
    base,
    resolve: {
        alias: {
            '@': resolve(__dirname, 'src')
        }
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    return getVendorChunkName(id)
                }
            }
        }
    }
})
