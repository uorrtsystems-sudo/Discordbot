/**
 * Cloudflare Workers throws "Illegal invocation" when `fetch` is called with
 * the wrong `this`. Binding once, then calling the wrapper, keeps `this` on
 * the global object even if a caller stores the function and invokes it as a method.
 */
export function bindFetch(fetchImpl: typeof fetch): typeof fetch {
  return (input, init) => fetchImpl.call(globalThis, input, init);
}
