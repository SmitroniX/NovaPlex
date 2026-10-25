import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { db } from '../src/db/database.js';
import { runTranscodeCacheHousekeeping } from '../src/server.js';
import { detectHardwareCapabilities, getHardwareAccelerationInfo } from '../src/stream/hlsTranscoder.js';

console.log('Testing NovaPlex Boost Features (Chapters, Watchlist, Favorites, Housekeeping, HWAccel)...');

// 1. Test Watchlist & Favorites tables & queries
const testUserId = 'user-admin';
const testMediaId = 'mov-aa8a501945b9';

// Clean test state
db.run('DELETE FROM watchlist WHERE user_id = ?', [testUserId]);
db.run('DELETE FROM favorites WHERE user_id = ?', [testUserId]);

// Add to watchlist
db.run('INSERT INTO watchlist (user_id, media_id) VALUES (?, ?)', [testUserId, testMediaId]);
let inWatch = db.queryOne('SELECT * FROM watchlist WHERE user_id = ? AND media_id = ?', [testUserId, testMediaId]);
assert.ok(inWatch, 'Item should be in watchlist');

// Remove from watchlist
db.run('DELETE FROM watchlist WHERE user_id = ? AND media_id = ?', [testUserId, testMediaId]);
inWatch = db.queryOne('SELECT * FROM watchlist WHERE user_id = ? AND media_id = ?', [testUserId, testMediaId]);
assert.ok(!inWatch, 'Item should be removed from watchlist');

// Add to favorites
db.run('INSERT INTO favorites (user_id, media_id) VALUES (?, ?)', [testUserId, testMediaId]);
let inFav = db.queryOne('SELECT * FROM favorites WHERE user_id = ? AND media_id = ?', [testUserId, testMediaId]);
assert.ok(inFav, 'Item should be in favorites');

// 2. Test Media Chapters table
db.run('DELETE FROM media_chapters WHERE media_id = ?', [testMediaId]);
db.run(`
  INSERT INTO media_chapters (id, media_id, chapter_index, start_time, end_time, title)
  VALUES (?, ?, ?, ?, ?, ?)
`, ['ch-test-1', testMediaId, 0, 0, 45, 'Intro']);

const ch = db.queryOne('SELECT * FROM media_chapters WHERE media_id = ?', [testMediaId]);
assert.ok(ch, 'Chapter should exist');
assert.strictEqual(ch.title, 'Intro');
assert.strictEqual(ch.start_time, 0);
assert.strictEqual(ch.end_time, 45);

// 3. Test Housekeeping Worker
const result = runTranscodeCacheHousekeeping();
assert.ok(typeof result.prunedCount === 'number');
assert.ok(typeof result.freedBytes === 'number');

// 4. Test Hardware Acceleration Detection
const hw = getHardwareAccelerationInfo();
assert.ok(hw);
assert.ok(typeof hw.mode === 'string');
assert.ok(typeof hw.isHardwareAccelerated === 'boolean');

console.log('✅ Boost features verified successfully!');
process.exit(0);
