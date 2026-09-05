/**
 * `server-only` throws on import outside the Next bundler, which would make the
 * server modules untestable. The guarantee it provides (never bundled into a
 * client build) is enforced by Next at build time, so stubbing it here does not
 * weaken anything — it only lets the tests import the modules Next would.
 */
export {};
