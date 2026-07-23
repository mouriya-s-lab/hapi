// The largest generated image the CLI will serve inline. Must stay in sync with the CLI-side
// limits in cli/src/claude/utils/startHappyServer.ts and cli/src/modules/common/generatedImages.ts.
export const MAX_GENERATED_IMAGE_BYTES = 25 * 1024 * 1024

// Generated images and sent files cross the /cli socket as base64 inside JSON-RPC. The shared
// limit also derives the largest raw file payload that fits this configured transport cap.
export { SOCKET_MAX_HTTP_BUFFER_SIZE } from '@hapi/protocol/socketLimits'
