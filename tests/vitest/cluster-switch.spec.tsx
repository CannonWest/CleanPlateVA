// @vitest-environment jsdom
/**
 * The "Group nearby places" switch (CRP-M6): a real switch — role, checked
 * state, the formal-register public words — that asks for the OTHER state
 * on click and never flips itself (the App owns and persists the choice).
 */
import { act, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { ClusterSwitch } from '../../app/ClusterSwitch'

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root | null = null
let asked: boolean[]

async function mount(on: boolean) {
    if (root) {
        await act(async () => {
            root?.unmount()
        })
    }
    root = createRoot(host)
    await act(async () => {
        root?.render(
            <StrictMode>
                <ClusterSwitch on={on} onToggle={(next) => { asked.push(next) }} />
            </StrictMode>,
        )
    })
    const button = host.querySelector('button[role="switch"]')
    if (!(button instanceof HTMLButtonElement)) throw new Error('no switch rendered')
    return button
}

beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    asked = []
})

afterEach(async () => {
    if (root) {
        await act(async () => {
            root?.unmount()
        })
        root = null
    }
    host.remove()
})

test('off: reports unchecked, offers to group, asks for ON on click', async () => {
    const button = await mount(false)
    expect(button.getAttribute('aria-checked')).toBe('false')
    expect(button.getAttribute('aria-label')).toBe('Group nearby places')
    expect(button.title).toBe('Group nearby places')
    await act(async () => {
        button.click()
    })
    expect(asked).toEqual([true])
    // The control does not flip itself — the App does, on persisting.
    expect(button.getAttribute('aria-checked')).toBe('false')
})

test('on: reports checked, offers every place, asks for OFF on click', async () => {
    const button = await mount(true)
    expect(button.getAttribute('aria-checked')).toBe('true')
    expect(button.title).toBe('Show every place')
    await act(async () => {
        button.click()
    })
    expect(asked).toEqual([false])
})

test('two icons, none of them emoji or text — Lucide only (§6.0)', async () => {
    const button = await mount(false)
    expect(button.querySelectorAll('svg')).toHaveLength(2)
    expect(button.textContent?.trim()).toBe('')
})
