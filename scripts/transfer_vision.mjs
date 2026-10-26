import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn } from 'node:child_process';
import { db } from '../server/src/db/database.js';
import { runKeepAliveHeartbeat } from '../server/src/scanner/gofileSync.js';

const TOKEN = 'iqZy69Xtvm2hSOA9tYMbuEzRc4OtPDH1';
const SEASON1_FOLDER_ID = 'ef62b2de-e440-4f83-95f2-4815ee46f4d2';

const EPISODES = [
  {
    id: 'ep-8aabddb3c715',
    localPath: '/home/ubuntu/NovaPlex/media/shows/Visionquest/Season 01/Visionquest.S01E01.1080p.mkv',
    strmPath: '/home/ubuntu/NovaPlex/media/shows/Visionquest/Season 01/Visionquest.S01E01.1080p.strm'
  },
  {
    id: 'ep-1334cb868836',
    localPath: '/home/ubuntu/NovaPlex/media/shows/Visionquest/Season 01/Visionquest.S01E02.1080p.WEB-DL.English.Hindi.MSubs.MoviesMod.ai.in.mkv',
    strmPath: '/home/ubuntu/NovaPlex/media/shows/Visionquest/Season 01/Visionquest.S01E02.1080p.WEB-DL.English.Hindi.MSubs.MoviesMod.ai.in.strm'
  }
];

async function getBestServer() {
  const res = await fetch('https://api.gofile.io/servers');
  const json = await res.json();
  const server = json.data?.servers?.[0]?.name || json.data?.serversAllZone?.[0]?.name || 'store-eu-par-8';
  return server;
}

function uploadFileWithCurl(server, filePath, folderId) {
  return new Promise((resolve, reject) => {
    const fileName = path.basename(filePath);
    console.log(`[Upload] Starting upload of "${fileName}" to server "${server}"...`);
    const startTime = Date.now();

    const args = [
      '-X', 'POST',
      `https://${server}.gofile.io/contents/uploadfile`,
      '-F', `file=@${filePath}`,
      '-F', `token=${TOKEN}`,
      '-F', `folderId=${folderId}`,
      '--progress-bar'
    ];

    const proc = spawn('curl', args, { stdio: ['inherit', 'pipe', 'inherit'] });
    let stdoutData = '';

    proc.stdout.on('data', chunk => {
      stdoutData += chunk.toString();
    });

    proc.on('close', code => {
      const durationSec = Math.round((Date.now() - startTime) / 1000);
      if (code !== 0) {
        return reject(new Error(`curl exited with code ${code}`));
      }
      try {
        const json = JSON.parse(stdoutData.trim());
        if (json.status !== 'ok') {
          return reject(new Error(`Gofile error: ${JSON.stringify(json)}`));
        }
        console.log(`[Upload] Completed in ${durationSec}s: ${fileName}`);
        resolve(json.data);
      } catch (err) {
        reject(new Error(`Failed to parse response: ${stdoutData.slice(0, 300)}`));
      }
    });

    proc.on('error', reject);
  });
}

async function run() {
  console.log('=== Transferring VisionQuest Series to Gofile Cloud ===');

  const server = await getBestServer();
  console.log(`Using Gofile server: ${server}`);

  for (const ep of EPISODES) {
    if (!fs.existsSync(ep.localPath)) {
      console.warn(`Local file not found: ${ep.localPath}, skipping upload.`);
      continue;
    }

    const stat = fs.statSync(ep.localPath);
    console.log(`\n--- Processing Episode: ${path.basename(ep.localPath)} (${(stat.size / (1024 * 1024)).toFixed(1)} MB) ---`);

    const uploadRes = await uploadFileWithCurl(server, ep.localPath, SEASON1_FOLDER_ID);
    console.log('Upload result:', {
      id: uploadRes.id,
      name: uploadRes.name,
      servers: uploadRes.servers
    });

    const primaryServer = (uploadRes.servers && uploadRes.servers[0]) ? uploadRes.servers[0] : server;
    const directStreamUrl = `https://${primaryServer}.gofile.io/download/web/${uploadRes.id}/${encodeURIComponent(uploadRes.name)}`;
    console.log(`Direct stream URL: ${directStreamUrl}`);

    // Verify stream URL is reachable
    const verifyRes = await fetch(directStreamUrl, {
      method: 'HEAD',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Range': 'bytes=0-1024'
      }
    });
    console.log(`Stream verification status: ${verifyRes.status} (${verifyRes.statusText})`);

    // Write .strm file
    fs.writeFileSync(ep.strmPath, directStreamUrl, 'utf-8');
    console.log(`Created .strm file: ${ep.strmPath}`);

    // Update database record
    db.run(
      'UPDATE tv_episodes SET file_path = ?, file_size = ? WHERE id = ?',
      [ep.strmPath, stat.size, ep.id]
    );
    console.log(`Updated database record for ${ep.id}`);

    // Remove local .mkv to free disk space
    fs.unlinkSync(ep.localPath);
    console.log(`Deleted local file: ${ep.localPath}`);
  }

  console.log('\n--- Running Keep-Alive Heartbeat across Cloud Files ---');
  const hb = await runKeepAliveHeartbeat();
  console.log('Heartbeat summary:', hb);

  console.log('\n=== VisionQuest Transfer to Gofile Complete! ===');
}

run().catch(err => {
  console.error('Transfer failed:', err);
  process.exit(1);
});
