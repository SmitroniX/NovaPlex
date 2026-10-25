import assert from 'node:assert';
import { db } from '../src/db/database.js';
import { scanner } from '../src/scanner/fileScanner.js';

console.log('Running NovaPlex End-to-End Integration Test...');

// 1. Get default libraries
const libraries = db.queryAll('SELECT * FROM libraries');
assert.ok(libraries.length >= 2, 'Should have at least 2 default libraries');

const movieLib = libraries.find(l => l.type === 'movie');
const showLib = libraries.find(l => l.type === 'show');
assert.ok(movieLib, 'Movie library must exist');
assert.ok(showLib, 'Show library must exist');

// 2. Trigger Scan on Movie Library
console.log('Scanning Movies Library...');
const movieScanResult = await scanner.scanLibrary(movieLib.id);
console.log('Movie Scan Result:', movieScanResult);

// Verify movies in database
const movies = db.queryAll('SELECT * FROM media_items WHERE library_id = ?', [movieLib.id]);
assert.ok(movies.length >= 2, `Should have indexed at least 2 movies, found ${movies.length}`);
console.log('Indexed Movies:', movies.map(m => `${m.title} (${m.release_year}) [${m.resolution} | ${m.hdr_format}]`));

// 3. Trigger Scan on TV Show Library
console.log('Scanning TV Shows Library...');
const showScanResult = await scanner.scanLibrary(showLib.id);
console.log('Show Scan Result:', showScanResult);

// Verify show and episodes in database
const shows = db.queryAll('SELECT * FROM media_items WHERE library_id = ?', [showLib.id]);
assert.ok(shows.length >= 1, `Should have indexed at least 1 show, found ${shows.length}`);

const episodes = db.queryAll('SELECT * FROM tv_episodes');
assert.ok(episodes.length >= 2, `Should have indexed at least 2 episodes, found ${episodes.length}`);
console.log('Indexed Episodes:', episodes.map(e => `S1E${e.episode_number}: ${e.title}`));

// 4. Test Playback State Recording
const adminUser = db.queryOne("SELECT id FROM users WHERE username = 'Home Owner'");
assert.ok(adminUser, 'Admin user must exist');

const testMovie = movies[0];
db.run(`
  INSERT INTO playback_state (user_id, media_id, position_seconds, duration_seconds, completed, last_watched_at)
  VALUES (?, ?, 145.5, ?, 0, CURRENT_TIMESTAMP)
  ON CONFLICT(user_id, media_id) DO UPDATE SET position_seconds = 145.5
`, [adminUser.id, testMovie.id, testMovie.duration_seconds || 1200]);

const savedProgress = db.queryOne('SELECT * FROM playback_state WHERE user_id = ? AND media_id = ?', [adminUser.id, testMovie.id]);
assert.strictEqual(savedProgress.position_seconds, 145.5);

console.log('✅ End-to-End integration test passed with flying colors!');
process.exit(0);
