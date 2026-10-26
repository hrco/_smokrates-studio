/** True when the Host header is this server's own loopback address on its own port. Blocks DNS rebinding. */
export function isLoopbackHost(hostHeader: string | undefined, port: number): boolean {
  return hostHeader === `127.0.0.1:${port}` || hostHeader === `localhost:${port}`;
}

/** True when the Origin header names this server's own loopback origin. */
export function isSameLoopbackOrigin(originHeader: string, port: number): boolean {
  return originHeader === `http://127.0.0.1:${port}` || originHeader === `http://localhost:${port}`;
}
