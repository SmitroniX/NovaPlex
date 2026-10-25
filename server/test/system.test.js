import assert from 'node:assert';
import {
  getActiveHlsSessions,
  terminateHlsSession,
  terminateAllHlsSessions,
  cleanTranscodeCache
} from '../src/stream/hlsTranscoder.js';

console.log('Testing NovaPlex System & Telemetry Layer...');

// 1. Verify getActiveHlsSessions returns an array
const sessions = getActiveHlsSessions();
assert.ok(Array.isArray(sessions), 'getActiveHlsSessions must return an array');

// 2. Verify terminateHlsSession handles non-existent session safely
const notFound = terminateHlsSession('non-existent-session-key');
assert.strictEqual(notFound, false, 'Terminating non-existent session must return false');

// 3. Verify cleanTranscodeCache executes safely
const cleaned = cleanTranscodeCache();
assert.strictEqual(typeof cleaned, 'number', 'cleanTranscodeCache must return number of cleaned folders');

// 4. Verify terminateAllHlsSessions executes cleanly
const count = terminateAllHlsSessions();
assert.strictEqual(typeof count, 'number', 'terminateAllHlsSessions must return count');

console.log('✅ System & Telemetry tests passed successfully!');
process.exit(0);
