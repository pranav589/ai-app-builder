import { cookies } from "next/headers"

const BACKEND_URL =
  process.env.BACKEND_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_API_URL ||
  "http://localhost:4000"

export async function serverFetch<T = unknown>(
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  const url = `${BACKEND_URL.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`

  const cookieStore = await cookies().catch(() => null)
  const cookieHeader = cookieStore ? cookieStore.toString() : ""

  const headers = new Headers(init?.headers)
  if (cookieHeader && !headers.has("cookie")) {
    headers.set("cookie", cookieHeader)
  }

  try {
    const res = await fetch(url, {
      ...init,
      headers,
      cache: init?.cache ?? "no-store",
    })

    if (!res.ok) {
      let errorMsg = `HTTP ${res.status}`
      try {
        const json = await res.json()
        if (json?.error) errorMsg = json.error
      } catch {}
      return { ok: false, status: res.status, error: errorMsg }
    }

    const data = (await res.json()) as T
    return { ok: true, status: res.status, data }
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err instanceof Error ? err.message : "Backend connection error",
    }
  }
}
