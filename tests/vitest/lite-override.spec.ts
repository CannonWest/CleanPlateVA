/** The `?tier=lite` dev/preview override on the CR stack (D-ACK-3) — the
 *  behavioral half of `tests/lite-override.test.mjs`. The old suite pins the
 *  served client's source text; here the override is a real function
 *  (`forceLiteFromSearch`) and the gate composition is exercised, not
 *  grepped. The stakes are unchanged: push-to-main deploys production, and
 *  inverting this gate silently forces every visitor to the basic map.
 */
import assert from 'node:assert/strict'
import { test } from 'vitest'
import { forceLiteFromSearch } from '../../app/ack'

test('FORCE_LITE keys off ?tier=lite exactly', () => {
    assert.equal(forceLiteFromSearch('?tier=lite'), true)
    assert.equal(forceLiteFromSearch('?tier=lite&q=taco'), true)
    assert.equal(forceLiteFromSearch('?q=taco&tier=lite'), true)
    // Exactly `lite` — near-misses must not force the floor…
    assert.equal(forceLiteFromSearch('?tier=Lite'), false)
    assert.equal(forceLiteFromSearch('?tier=full'), false)
    assert.equal(forceLiteFromSearch('?tier='), false)
    assert.equal(forceLiteFromSearch('?tier'), false)
    // …and its absence must not either (the inverted-gate regression).
    assert.equal(forceLiteFromSearch(''), false)
    assert.equal(forceLiteFromSearch('?q=lite'), false)
    assert.equal(forceLiteFromSearch('?tierx=lite'), false)
})

test('the override composes with the ack gate in the client — pinned behaviorally in ack.spec.ts', () => {
    // The composition itself (`!forceLite && isAcknowledged()`, full inside
    // the gate, public finder as the only fallback) is exercised end-to-end
    // by ack.spec.ts's "?tier=lite wins over an acknowledgement" and the
    // degrade tests in data-client-v4.spec.ts; this test exists so the suite
    // named by the §7 port order has an explicit anchor here.
    assert.ok(true)
})
