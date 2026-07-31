/**
 * A `this`-safe reference to the runtime's global `fetch`.
 *
 * In the Workers runtime `fetch` is a native binding of the global scope, and workerd
 * rejects it when it is invoked as a method of anything else:
 * `Illegal invocation: function called with incorrect 'this' reference.`
 *
 * Stashing the bare global in a field (`private readonly fetchImpl: typeof fetch = fetch`)
 * and later calling `this.fetchImpl(...)` does exactly that — the receiver becomes the
 * instance rather than the global scope. Injection points default to this wrapper instead:
 * calling through it keeps `fetch` a plain global call. The global is resolved per call, so
 * stubbing `globalThis.fetch` in a test still works.
 *
 * Node's `fetch` ignores its receiver, which is why this only ever fails once deployed.
 */
export const globalFetch: typeof fetch = (input, init) => fetch(input, init);
