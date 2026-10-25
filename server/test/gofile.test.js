import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../src/db/database.js';
import {
  getGofileCredentials,
  findAllStrmFiles,
  createStrmFile,
  pingGofileFile,
  runKeepAliveHeartbeat
} from '../src/scanner/gofileSync.js';
import { analyzeMediaFile } from '../src/scanner/ffprobeAnalyzer.js';
import { streamDirectPlay } from '../src/stream/directPlayer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runGofileTests() {
  console.log('Testing Gofile Cloud Storage, Direct Streaming & Keep-Alive Layer...');

  // 1. Credentials retrieval
  const creds = getGofileCredentials();
  assert.strictEqual(typeof creds.token, 'string');
  assert.ok(creds.token.length > 0);
  assert.strictEqual(creds.keepAliveEnabled, true);
  console.log('  ✓ Gofile credentials correctly configured from database');

  // 2. Create .strm file for testing
  const sampleUrl = 'https://store10.gofile.io/download/web/96c7ccec-9c63-443f-8f1f-86739468a5fc/gofile_sample_video.mp4';
  const strmResult = createStrmFile({
    libraryType: 'movie',
    title: 'Gofile Test Stream',
    year: 2026,
    streamUrl: sampleUrl
  });

  assert.ok(fs.existsSync(strmResult.filePath));
  const fileContent = fs.readFileSync(strmResult.filePath, 'utf-8');
  assert.strictEqual(fileContent, sampleUrl);
  console.log('  ✓ .strm cloud file created successfully');

  // 3. Find all .strm files in libraries
  const strmFiles = findAllStrmFiles();
  assert.ok(strmFiles.length >= 1);
  const found = strmFiles.find(f => f.url === sampleUrl);
  assert.ok(found);
  console.log(`  ✓ Discovered ${strmFiles.length} .strm file(s) across libraries`);

  // 4. Test 1 KB Keep-Alive ping to Gofile CDN
  console.log('  -> Sending 1 KB Keep-Alive ping to Gofile CDN...');
  const pingRes = await pingGofileFile(sampleUrl, creds.token);
  assert.strictEqual(pingRes.statusCode, 206);
  assert.strictEqual(pingRes.success, true);
  console.log(`  ✓ Keep-alive ping acknowledged with HTTP 206 Partial Content (Read ${pingRes.bytesRead} bytes)`);

  // 5. Test Full Heartbeat cycle
  const heartbeatRes = await runKeepAliveHeartbeat();
  assert.strictEqual(heartbeatRes.success, true);
  assert.ok(heartbeatRes.successCount >= 1);
  const lastHeartbeat = db.queryOne("SELECT value FROM server_settings WHERE key = 'gofile_last_heartbeat'")?.value;
  assert.ok(lastHeartbeat);
  console.log(`  ✓ Heartbeat cycle updated last_heartbeat timestamp: ${lastHeartbeat}`);

  // 6. Test ffprobe analyzer on .strm file
  console.log('  -> Probing remote .strm video stream with ffprobe...');
  const mediaInfo = await analyzeMediaFile(strmResult.filePath);
  assert.strictEqual(mediaInfo.videoCodec, 'h264');
  assert.strictEqual(mediaInfo.width, 320);
  assert.strictEqual(mediaInfo.height, 240);
  console.log(`  ✓ Remote Gofile stream successfully analyzed by ffprobe: ${mediaInfo.width}x${mediaInfo.height} ${mediaInfo.videoCodec}`);

  // 7. Test Direct Play HTTP Range streaming simulation
  console.log('  -> Testing Direct Play HTTP Range proxy on .strm file...');
  let resStatus = 0;
  const resHeaders = {};

  const mockReq = {
    method: 'GET',
    headers: {
      range: 'bytes=0-100'
    },
    on: () => {}
  };

  const { PassThrough } = await import('node:stream');
  const mockRes = new PassThrough();
  mockRes.headersSent = false;
  mockRes.writeHead = (status, headers) => {
    resStatus = status;
    Object.assign(resHeaders, headers);
  };

  await new Promise((resolve) => {
    mockRes.on('finish', () => resolve());
    mockRes.on('data', () => {
      // Data chunk received
    });
    mockRes.on('close', () => resolve());
    streamDirectPlay(mockReq, mockRes, strmResult.filePath, 'video/mp4');
    setTimeout(resolve, 1500);
  });

  assert.strictEqual(resStatus, 206);
  assert.strictEqual(resHeaders['Accept-Ranges'], 'bytes');
  assert.ok(resHeaders['Content-Range']);
  console.log(`  ✓ Direct Play Range proxy returned HTTP 206 with Content-Range: ${resHeaders['Content-Range']}`);

  // Clean up test file and directory
  try {
    fs.unlinkSync(strmResult.filePath);
    fs.rmdirSync(strmResult.folderPath);
  } catch (e) {}

  console.log('✅ Gofile Cloud Storage, Streaming & Auto Keep-Alive tests passed 100%!\n');
}

runGofileTests().catch((err) => {
  console.error('❌ Gofile test failed:', err);
  process.exit(1);
});
