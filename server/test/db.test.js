import assert from 'node:assert';
import { DatabaseManager } from '../src/db/database.js';

console.log('Testing NovaPlex Database Layer...');

const testDb = new DatabaseManager(':memory:');

// 1. Verify users seeded
const users = testDb.queryAll('SELECT * FROM users');
assert.strictEqual(users.length, 2, 'Default users should be seeded');
const adminUser = users.find(u => u.username === 'Home Owner');
assert.ok(adminUser, 'Admin user should exist');
assert.strictEqual(adminUser.is_admin, 1, 'Admin user should have is_admin = 1');

// 2. Verify server settings
const serverName = testDb.queryOne('SELECT value FROM server_settings WHERE key = ?', ['server_name']);
assert.ok(serverName && serverName.value.includes('NovaPlex'), 'Server name setting should exist');

// 3. Test Library & Media Items CRUD with cascades
testDb.run(
  'INSERT INTO libraries (id, name, type, paths) VALUES (?, ?, ?, ?)',
  ['lib-test-1', 'Movies 4K', 'movie', JSON.stringify(['/media/movies'])]
);

const lib = testDb.queryOne('SELECT * FROM libraries WHERE id = ?', ['lib-test-1']);
assert.strictEqual(lib.name, 'Movies 4K');

testDb.run(`
  INSERT INTO media_items (
    id, library_id, type, title, release_year, resolution, hdr_format, file_path
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`, ['item-1', 'lib-test-1', 'movie', 'Dune: Part Two', 2024, '4K UHD', 'HDR10+', '/media/movies/dune.mkv']);

const movie = testDb.queryOne('SELECT * FROM media_items WHERE id = ?', ['item-1']);
assert.strictEqual(movie.title, 'Dune: Part Two');
assert.strictEqual(movie.resolution, '4K UHD');
assert.strictEqual(movie.hdr_format, 'HDR10+');

// 4. Test streams
testDb.run(`
  INSERT INTO media_streams (id, media_id, stream_type, stream_index, codec, language, channels)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`, ['str-1', 'item-1', 'audio', 1, 'eac3', 'eng', 6]);

const streams = testDb.queryAll('SELECT * FROM media_streams WHERE media_id = ?', ['item-1']);
assert.strictEqual(streams.length, 1);
assert.strictEqual(streams[0].codec, 'eac3');

// 5. Test Cascade Deletion
testDb.run('DELETE FROM libraries WHERE id = ?', ['lib-test-1']);
const remainingMovies = testDb.queryAll('SELECT * FROM media_items WHERE id = ?', ['item-1']);
assert.strictEqual(remainingMovies.length, 0, 'Media items should be cascade deleted when library is removed');

testDb.close();
console.log('✅ Database layer tests passed successfully!');
