/**
 * Kenyan phone number validation & normalisation.
 *
 * The implementation lives in `src/shared/phone.ts` so Cloud Functions (`functions/src/shared/phone.ts`,
 * a byte-identical copy checked by `functions/src/shared/sync.test.ts`) validate numbers exactly the way
 * the app does. Import from here in app code; this file only re-exports.
 */
export * from '../shared/phone';
