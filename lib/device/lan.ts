import "server-only"
import os from "node:os"

/** The machine's own LAN address, not Metro's idea of one: a phone on the same Wi-Fi reaches the computer at this address, whatever host Metro thinks it's bound to. */
export function lanIPv4(): string | null {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces ?? []) if (i.family === "IPv4" && !i.internal) return i.address
  }
  return null
}

/**
 * lanIPv4(), retried for just over a second: a Wi-Fi adapter can briefly report no
 * non-internal IPv4 address during a reconnect or DHCP renewal, and a null caught at
 * that instant would point a built app at "localhost", which is silently unreachable
 * from a phone. Resolves on the first attempt once the adapter is up.
 */
export async function lanIPv4Stable(attempts = 6, delayMs = 200): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const ip = lanIPv4()
    if (ip) return ip
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs))
  }
  return null
}
