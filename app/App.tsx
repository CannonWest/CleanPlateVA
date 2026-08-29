// CRF-M0 scaffold proof — deliberately NOT a view. Zero UI beyond proof
// (briefing scope): this surface exists to prove the token vocabulary
// (@theme from docs/mockups/tokens.css), the class-based theme flip (C10),
// Lucide tree-shaken inline SVGs (§6.0), and tabular-nums — then CRF-M1
// replaces it with the UI-less proof boot (gray basic map + acked merge).
// The views are CRV's, built to the §6 acceptance specs.
import { useState } from 'react'
import { MapPin, SunMedium, MoonStar } from 'lucide-react'

const RAMP = [
    ['A', 'bg-cp-grade-a'],
    ['B', 'bg-cp-grade-b'],
    ['C', 'bg-cp-grade-c'],
    ['D', 'bg-cp-grade-d'],
    ['F', 'bg-cp-grade-f'],
    ['—', 'bg-cp-grade-none'],
] as const

export function App() {
    const [light, setLight] = useState(false)

    function flipTheme() {
        const next = !light
        document.documentElement.classList.toggle('theme-light', next)
        setLight(next)
    }

    return (
        <main className="mx-auto max-w-xl p-6">
            <section className="rounded-cp-card border border-cp-hairline bg-cp-surface-1 p-5 shadow-cp">
                <div className="flex items-center justify-between gap-3">
                    <h1 className="flex items-center gap-2 text-lg font-semibold">
                        <MapPin className="size-5 text-cp-accent" aria-hidden />
                        CleanPlateVA
                    </h1>
                    <button
                        type="button"
                        onClick={flipTheme}
                        className="flex items-center gap-2 rounded-cp-control border border-cp-hairline bg-cp-surface-2 px-3 py-1.5 text-[13px] font-semibold"
                    >
                        {light ? <MoonStar className="size-4" aria-hidden /> : <SunMedium className="size-4" aria-hidden />}
                        {light ? 'Dark' : 'Light'}
                    </button>
                </div>

                <p className="mt-2 text-cp-ink-2">
                    CRF scaffold proof — Vite · React · TypeScript strict · Tailwind v4 ·
                    Vitest · Lucide. The served site is untouched until CRC.
                </p>

                <div className="mt-4 flex items-center gap-2" aria-label="grade ramp proof">
                    {RAMP.map(([letter, color]) => (
                        <span
                            key={letter}
                            className={`${color} flex h-7 min-w-7 items-center justify-center rounded-cp-pill px-2 text-[12.5px] font-bold text-white`}
                        >
                            {letter}
                        </span>
                    ))}
                </div>

                <p className="mt-4 text-[12.5px] text-cp-ink-3 tabular-nums">
                    tokens ratified 2026-08-29 · scaffold 2026-08-29
                </p>
            </section>
        </main>
    )
}
