// Fork feature (#271): the canonical hapi-agent skill is embedded as a file
// asset in Bun-compiled binaries (see runtime/embeddedAssets.bun.ts).
declare module '*/SKILL.md' {
    const path: string;
    export default path;
}
