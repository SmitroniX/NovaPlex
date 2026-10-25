import assert from 'node:assert';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { streamDirectPlay } from '../src/stream/directPlayer.js';
import { getOrCreateHlsSession } from '../src/stream/hlsTranscoder.js';

console.log('Testing NovaPlex Streaming & 4K/HDR Tonemapping Layer...');

const samplePath = '/home/ubuntu/SmiTriX/brag-output/brag.mp4';
assert.ok(fs.existsSync(samplePath), 'Sample test video must exist');

// 1. Test Direct Play HTTP Range logic
let directStatus = 0;
let directHeaders = {};

class MockResponse extends EventEmitter {
  writeHead(status, headers) {
    directStatus = status;
    directHeaders = headers;
  }
  status(s) {
    directStatus = s;
    return this;
  }
  send() {}
  end() {}
  write() { return true; }
}

const mockDirectRes = new MockResponse();
const mockDirectReq = {
  method: 'GET',
  headers: {
    range: 'bytes=0-1023'
  }
};

streamDirectPlay(mockDirectReq, mockDirectRes, samplePath);
assert.strictEqual(directStatus, 206, 'Should respond with HTTP 206 Partial Content');
assert.ok(directHeaders['Content-Range'].startsWith('bytes 0-1023/'), 'Content-Range must match request range');
assert.strictEqual(directHeaders['Content-Length'], 1024, 'Content-Length must equal range size');

// 2. Test HLS Transcoding with HDR-to-SDR Tonemap
console.log('Testing HLS Transcode with HDR-to-SDR Tonemap (Turn Off HDR)...');
const session = await getOrCreateHlsSession('test-media-1', samplePath, '720p', 'off', 0);
assert.ok(session, 'Session must be created');
assert.ok(fs.existsSync(session.playlistPath), 'stream.m3u8 playlist file must exist on disk');

const playlistContent = fs.readFileSync(session.playlistPath, 'utf-8');
assert.ok(playlistContent.includes('#EXTM3U'), 'Playlist must contain valid HLS EXTM3U header');

// Clean up
if (session.process && !session.process.killed) {
  session.process.kill('SIGTERM');
}
try {
  fs.rmSync(session.dir, { recursive: true, force: true });
} catch (_) {}

console.log('✅ Streaming & Tonemapping tests passed successfully!');
process.exit(0);
