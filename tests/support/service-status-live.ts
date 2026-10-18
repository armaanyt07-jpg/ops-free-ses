/**
 * The suite tests the running product, so it sees the service as live even
 * while production is paused. tests/unit/paused-mode.test.ts covers the pause.
 */
export { PAUSED_MESSAGE } from "../../src/lib/service-status";
export const SERVICE_PAUSED = false;
