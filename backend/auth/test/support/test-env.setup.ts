// Jest `setupFiles`: runs in every worker before any test file is imported, so
// `src/config` validates the test values (dotenv never overrides them).
import { applyTestEnv } from './test-env';

applyTestEnv();
