// Socket.IO carries RPC binary content as base64 inside a JSON envelope. Keep one MiB for
// the envelope and derive the largest raw payload that always fits below the configured cap.
export const SOCKET_MAX_HTTP_BUFFER_SIZE = 48 * 1024 * 1024
export const SOCKET_RPC_FRAMING_HEADROOM_BYTES = 1024 * 1024
export const MAX_SOCKET_RPC_BINARY_BYTES = Math.floor(
    (SOCKET_MAX_HTTP_BUFFER_SIZE - SOCKET_RPC_FRAMING_HEADROOM_BYTES) * 3 / 4
)
