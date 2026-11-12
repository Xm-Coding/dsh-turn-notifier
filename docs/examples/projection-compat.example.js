/**
 * Example only. This is not imported by the production plugin.
 *
 * Newer Harness registration resolves to a handle with stateOf(session).
 * The inspected older installation uses registry.stateOf(session, key).
 * Cordis registrations can be callable thenables: do not use instanceof Promise.
 *
 * Register once on the owning plugin context. Verify that version's effect
 * cleanup semantics, and buffer live events during initialization in the caller.
 * Do not return an arbitrary registration handle as a ctx.effect cleanup function.
 * This helper neither installs event listeners nor proves cross-version support.
 */
export async function registerProjectionReader(registry, definition) {
  const registration = await registry.register(definition);

  if (registration && typeof registration.stateOf === 'function') {
    return (session) => registration.stateOf(session);
  }

  if (typeof registry.stateOf === 'function') {
    return (session) => registry.stateOf(session, definition.key);
  }

  // Fixed diagnostic: never attach session text or an arbitrary original Error.
  throw new Error('unsupported-session-projection-api');
}
