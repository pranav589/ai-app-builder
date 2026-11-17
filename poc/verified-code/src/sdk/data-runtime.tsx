import * as React from "react"

// @app/data-runtime — the generic store behind the generated, typed hooks in "@/data".
// App code never imports this module directly (policy gate); it uses "@/data".

export type BaseRecord = { id: string; createdAt: string }
type Row = BaseRecord & Record<string, unknown>

export type QueryOptions<T> = {
  where?: Partial<T> | ((record: T) => boolean)
  /** "field" ascending, "-field" descending */
  sort?: string
  limit?: number
}

export type CollectionApi<T extends BaseRecord> = {
  data: T[]
  add: (values: Omit<T, "id" | "createdAt">) => T
  update: (id: string, patch: Partial<Omit<T, "id" | "createdAt">>) => void
  remove: (id: string) => void
}

export type RecordApi<T extends BaseRecord> = {
  data: T | null
  update: (patch: Partial<Omit<T, "id" | "createdAt">>) => void
  remove: () => void
}

export class DataStore {
  private rows: Record<string, Row[]> = {}
  private listeners = new Set<() => void>()
  private counter = 0

  constructor(seed: Record<string, Record<string, unknown>[]>) {
    for (const [entity, list] of Object.entries(seed)) {
      this.rows[entity] = list.map((r, i) => ({ createdAt: "2026-01-01T00:00:00.000Z", ...r, id: String(r.id ?? `${entity.toLowerCase()}-${i + 1}`) }))
    }
  }
  list(entity: string): Row[] {
    return (this.rows[entity] ??= [])
  }
  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private set(entity: string, next: Row[]) {
    this.rows[entity] = next
    for (const fn of this.listeners) fn()
  }
  add(entity: string, values: Record<string, unknown>): Row {
    const row: Row = { ...values, id: `${entity.toLowerCase()}-n${++this.counter}`, createdAt: new Date(Date.UTC(2026, 0, 2, 0, 0, this.counter)).toISOString() }
    this.set(entity, [...this.list(entity), row])
    return row
  }
  update(entity: string, id: string, patch: Record<string, unknown>) {
    this.set(entity, this.list(entity).map((r) => (r.id === id ? { ...r, ...patch, id: r.id, createdAt: r.createdAt } : r)))
  }
  remove(entity: string, id: string) {
    this.set(entity, this.list(entity).filter((r) => r.id !== id))
  }
}

const StoreContext = React.createContext<DataStore | null>(null)

export function DataProvider({ store, children }: { store: DataStore; children?: React.ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

function useStore() {
  const store = React.useContext(StoreContext)
  if (!store) throw new Error("Data hooks must be used inside <DataProvider>.")
  return store
}

export function useCollection<T extends BaseRecord>(entity: string, opts: QueryOptions<T> = {}): CollectionApi<T> {
  const store = useStore()
  const rows = React.useSyncExternalStore(store.subscribe, () => store.list(entity)) as unknown as T[]
  const { where, sort, limit } = opts
  const data = React.useMemo(() => {
    let out = rows
    if (typeof where === "function") out = out.filter(where)
    else if (where) out = out.filter((r) => Object.entries(where).every(([k, v]) => (r as Record<string, unknown>)[k] === v))
    if (sort) {
      const desc = sort.startsWith("-")
      const key = desc ? sort.slice(1) : sort
      out = [...out].sort((a, b) => {
        const av = (a as Record<string, unknown>)[key] as never
        const bv = (b as Record<string, unknown>)[key] as never
        return (av < bv ? -1 : av > bv ? 1 : 0) * (desc ? -1 : 1)
      })
    }
    return limit ? out.slice(0, limit) : out
    // `where` as a function is usually a new closure each render; it is cheap to re-run.
  }, [rows, where, sort, limit])
  return {
    data,
    add: (values) => store.add(entity, values as Record<string, unknown>) as unknown as T,
    update: (id, patch) => store.update(entity, id, patch as Record<string, unknown>),
    remove: (id) => store.remove(entity, id),
  }
}

export function useRecord<T extends BaseRecord>(entity: string, id: string | undefined | null): RecordApi<T> {
  const store = useStore()
  const rows = React.useSyncExternalStore(store.subscribe, () => store.list(entity))
  const data = (id ? (rows.find((r) => r.id === id) ?? null) : null) as T | null
  return {
    data,
    update: (patch) => {
      if (id) store.update(entity, id, patch as Record<string, unknown>)
    },
    remove: () => {
      if (id) store.remove(entity, id)
    },
  }
}
