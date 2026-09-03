package app.hapi.companion

/**
 * Hand-rolled dependency graph seed (no Hilt/Dagger by design -- the app wires
 * roughly 15 long-lived types, which does not justify a DI framework).
 *
 * From M1 on this becomes a class instantiated in `HapiApplication.onCreate()`
 * that owns the singletons in construction order:
 * CredentialStore -> AuthManager -> HapiApi -> SseEngine -> stores
 * (session list / session detail / message window) -> push registration.
 * Compose reads it via a CompositionLocal; workers/services reach it through
 * the Application instance. Everything behind it stays constructor-injected
 * and unit-testable without this object.
 */
object AppGraph
