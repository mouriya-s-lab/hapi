// Barrel that pulls fork-features/multi-user/legacyDbCompat.test.ts into
// hub's `bun test` discovery path. The real test module lives with the
// implementation under fork-features/; keeping this file in hub/src/store/
// avoids editing hub/package.json to broaden the test glob.
import '../../../fork-features/multi-user/legacyDbCompat.test'
