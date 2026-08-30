// The React binding over the Contract V4 client (design ref §5): ONE
// provider owns the loaded roster + manifest and exposes it; no fetch
// happens in any component body — every network read goes through the client
// module, so the request budget (C3) stays auditable in one file. The
// provider re-runs the load when the ack answer changes (C2's re-load
// semantics), and while the first-load answer is still owed it fetches
// NOTHING (C2: zero data requests until answered).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AckState } from '../ack'
import type { FoodApi } from './client'
import type { FacilityDetail, RosterResult, RosterRow } from './types'

export type RosterStatus =
    | { status: 'awaiting-ack' }
    | { status: 'loading' }
    | { status: 'ready'; result: RosterResult }

interface DataContextValue {
    roster: RosterStatus
    /** The lazy closed supplement (D-DATA-7): fetched once per Full load on
     *  the first "Show closed" — the boot never pays for it. Failure is
     *  silent and retryable (the client resets its promise); closed rows
     *  simply stay absent. */
    closed: RosterRow[]
    ensureClosed: () => void
    /** The per-facility detail, on CLICK only (P5) — the client owns the
     *  LRU, the standards memo, and the contract validation. */
    getDetail: (permitId: string) => Promise<FacilityDetail>
    /** Re-run the load (the ack answer is read through the client's gate). */
    reload: () => void
}

const DataContext = createContext<DataContextValue | null>(null)

export function DataProvider({ api, ack, forceLite, children }: {
    api: FoodApi
    ack: AckState
    forceLite: boolean
    children: ReactNode
}) {
    const [roster, setRoster] = useState<RosterStatus>({ status: 'awaiting-ack' })
    const [closed, setClosed] = useState<RosterRow[]>([])
    // The ack VALUE is state the provider reacts to; the client reads the
    // answer itself at call time through its gate.
    const [ackValue, setAckValue] = useState(ack.value)

    const reload = useCallback(() => setAckValue(ack.value), [ack])

    useEffect(() => {
        // C2: the deferred first load — an undecided visitor (outside
        // ?tier=lite) fetches nothing at all.
        if (!forceLite && !ack.decided) {
            setRoster({ status: 'awaiting-ack' })
            return
        }
        let alive = true
        setRoster({ status: 'loading' })
        setClosed([]) // a re-load starts a fresh tier; closed re-arms lazy
        void api.getFoodFacilities().then((result) => {
            if (alive) setRoster({ status: 'ready', result })
        })
        return () => { alive = false }
    }, [api, ack, forceLite, ackValue])

    const ensureClosed = useCallback(() => {
        void api.loadClosed()
            .then((rows) => setClosed((current) => (current.length ? current : rows)))
            .catch(() => { /* degrade: the toggle can be flipped again */ })
    }, [api])

    const getDetail = useCallback(
        (permitId: string) => api.getFoodFacilityDetail(permitId),
        [api],
    )

    const value = useMemo(
        () => ({ roster, closed, ensureClosed, getDetail, reload }),
        [roster, closed, ensureClosed, getDetail, reload],
    )
    return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useRoster(): DataContextValue {
    const value = useContext(DataContext)
    if (!value) throw new Error('useRoster outside DataProvider')
    return value
}
