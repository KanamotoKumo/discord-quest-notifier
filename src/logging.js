// ─── Logging ──────────────────────────────────────────────────────────────
const timestamp = () => new Date().toISOString();

export function log(message) {
    console.log(`[${timestamp()}] ✓ ${message}`);
}

export function warn(message) {
    console.warn(`[${timestamp()}] ⚠️  ${message}`);
}

export function error(message) {
    console.error(`[${timestamp()}] ❌ ${message}`);
}

export function info(message) {
    console.info(`[${timestamp()}] ℹ️  ${message}`);
}
