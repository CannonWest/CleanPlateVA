/**
 * The acknowledgement STATE (C2; ports the pure half of the old `ack.js` —
 * design ref §5). The stored decision is ONE versioned localStorage key; bump
 * ACK_VERSION whenever the terms text changes and every device is asked
 * again. The in-memory state starts from storage and is shared by the data
 * client's gate (`isAcknowledged`) and the app, so an unpersisted decision
 * (Escape on the first-load dialog) still governs this page load.
 *
 * The DIALOG — blocking first load, the About §06 clone, the two buttons —
 * is chrome and is rebuilt by CRV to the §6.1 acceptance spec; nothing of it
 * lives here.
 */

export const ACK_VERSION = 1
export const ACK_KEY = `cleanplateva.ack.v${ACK_VERSION}`
export const ACK_AGREED = 'agreed'
export const ACK_DECLINED = 'declined'

export type AckValue = typeof ACK_AGREED | typeof ACK_DECLINED

/** The slice of Storage the ack state needs — fakes and private-mode
 *  throwers included, which is why every access is try/caught. */
export interface StorageLike {
    getItem(key: string): string | null
    setItem(key: string, value: string): void
}

/** The stored decision, or null when this device has not answered the
 *  CURRENT version of the terms (a value under an older key is ignored). */
export function readAck(storage: Partial<StorageLike> | null | undefined): AckValue | null {
    try {
        const value = storage?.getItem?.(ACK_KEY)
        return value === ACK_AGREED || value === ACK_DECLINED ? value : null
    } catch {
        return null // private mode / sandboxed frame
    }
}

export function writeAck(storage: Partial<StorageLike> | null | undefined, value: string): void {
    try {
        storage?.setItem?.(ACK_KEY, value)
    } catch {
        /* private mode */
    }
}

export interface AckState {
    readonly value: AckValue | null
    readonly agreed: boolean
    readonly decided: boolean
    /** False for an answer that governs only this page load (Escape). */
    readonly persisted: boolean
    set(next: string | null, options?: { persist?: boolean }): void
}

/** The in-memory decision the page runs on. */
export function createAckState(storage: Partial<StorageLike> | null | undefined): AckState {
    let value = readAck(storage)
    let persisted = value !== null // a stored answer is, by definition, persisted
    return {
        get value() { return value },
        get agreed() { return value === ACK_AGREED },
        get decided() { return value !== null },
        get persisted() { return persisted },
        set(next, { persist = true } = {}) {
            value = next === ACK_AGREED || next === ACK_DECLINED ? next : null
            persisted = !!(persist && value)
            if (persisted && value) writeAck(storage, value)
        },
    }
}

/** `?tier=lite` (D-ACK-3): the dev/preview override — the basic map, no
 *  terms asked, the control hidden. Read once at boot, exactly this key and
 *  value; inverting this gate would silently force every visitor to the
 *  basic map (the old `lite-override` tripwire's warning, now behavioral). */
export function forceLiteFromSearch(search: string): boolean {
    return new URLSearchParams(search).get('tier') === 'lite'
}
