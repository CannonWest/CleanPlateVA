// CRF-M1 proof boot — deliberately NOT a view (briefing scope: zero view
// UI). This surface proves the ported data layer end to end on the Vite dev
// server: the ack-gated boot (C2: an undecided visitor fetches NOTHING), the
// gray basic map, the acked overlay merge (dots take the ramp), counts, and
// `?tier=lite`. The Agree/Decline strip is PROOF SCAFFOLDING standing in
// for the §6.1 ack dialog; CRV-a builds the real chrome to the acceptance
// specs and replaces this file's shell.
import { useMemo, useState } from 'react'
import { ACK_AGREED, ACK_DECLINED, createAckState, forceLiteFromSearch } from './ack'
import { createFoodApi } from './data/client'
import { fmtDate } from './data/presentation'
import { DataProvider, useRoster } from './data/provider'
import { ProofMap } from './ProofMap'

export function App() {
    const forceLite = useMemo(() => forceLiteFromSearch(window.location.search), [])
    const ack = useMemo(() => createAckState(window.localStorage), [])
    const api = useMemo(
        () => createFoodApi({ forceLite, isAcknowledged: () => ack.agreed }),
        [forceLite, ack],
    )
    return (
        <DataProvider api={api} ack={ack} forceLite={forceLite}>
            <ProofShell
                forceLite={forceLite}
                agreed={() => ack.agreed}
                decide={(value) => ack.set(value)}
            />
        </DataProvider>
    )
}

function ProofShell({ forceLite, agreed, decide }: {
    forceLite: boolean
    agreed: () => boolean
    decide: (value: string) => void
}) {
    const { roster, reload } = useRoster()
    const [, bump] = useState(0)

    function answer(value: string) {
        decide(value)
        bump((n) => n + 1)
        reload()
    }

    return (
        <div className="relative h-dvh w-full">
            {roster.status === 'ready' && 'facilities' in roster.result && (
                <ProofMap
                    facilities={roster.result.facilities}
                    lite={roster.result.mode === 'lite'}
                />
            )}
            <section className="absolute top-3 left-3 z-10 max-w-sm rounded-cp-card border border-cp-hairline bg-cp-surface-1/95 p-3 shadow-cp">
                <h1 className="text-[13px] font-semibold">CRF-M1 proof boot</h1>
                <p className="mt-1 text-[12.5px] text-cp-ink-2 tabular-nums">{statusLine(roster, forceLite)}</p>
                {!forceLite && (
                    <div className="mt-2 flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => answer(ACK_AGREED)}
                            className="rounded-cp-control bg-cp-accent-solid px-2.5 py-1 text-[12px] font-semibold text-cp-accent-ink"
                        >
                            Agree (proof)
                        </button>
                        <button
                            type="button"
                            onClick={() => answer(ACK_DECLINED)}
                            className="rounded-cp-control bg-cp-danger-solid px-2.5 py-1 text-[12px] font-semibold text-white"
                        >
                            Decline (proof)
                        </button>
                        <span className="text-[11px] text-cp-ink-3">{agreed() ? 'grades on' : 'basic map'}</span>
                    </div>
                )}
                <p className="mt-2 text-[11px] text-cp-ink-3">
                    Proof scaffolding — the §6.1 dialog and every view are CRV&apos;s.
                </p>
            </section>
        </div>
    )
}

function statusLine(roster: ReturnType<typeof useRoster>['roster'], forceLite: boolean): string {
    if (roster.status === 'awaiting-ack') {
        return 'Awaiting the acknowledgement — nothing fetched (C2).'
    }
    if (roster.status === 'loading') return 'Loading…'
    const result = roster.result
    if (!('facilities' in result)) return `Unavailable: ${result.reason}`
    const tier = result.mode === 'full' ? 'grades on' : 'basic map'
    const override = forceLite ? ' · ?tier=lite' : ''
    return `${result.facilities.length.toLocaleString()} places · ${tier}${override}`
        + ` · data ${fmtDate(result.freshness?.newest_report)}`
}
