import assert from 'node:assert';
import { parseMovieFilename, parseEpisodeFilename } from '../src/scanner/nameParser.js';
import { analyzeMediaFile } from '../src/scanner/ffprobeAnalyzer.js';
import { fetchMovieMetadata } from '../src/metadata/metadataFetcher.js';

console.log('Testing NovaPlex Scanner & Parser Layer...');

// 1. Test Movie Name Parser
const m1 = parseMovieFilename('/media/movies/Oppenheimer (2023) [2160p HDR10+].mkv');
assert.strictEqual(m1.title, 'Oppenheimer');
assert.strictEqual(m1.year, 2023);

const m2 = parseMovieFilename('/media/movies/Dune.Part.Two.2024.1080p.Web-DL.mp4');
assert.strictEqual(m2.title, 'Dune Part Two');
assert.strictEqual(m2.year, 2024);

const m3 = parseMovieFilename('/media/movies/The Matrix 1999 Remux.mkv');
assert.strictEqual(m3.title, 'The Matrix');
assert.strictEqual(m3.year, 1999);

// 2. Test TV Show Name Parser
const e1 = parseEpisodeFilename('/media/shows/Breaking Bad/Season 01/Breaking Bad S01E03 And the Bag is in the River.mkv');
assert.strictEqual(e1.showTitle, 'Breaking Bad');
assert.strictEqual(e1.seasonNumber, 1);
assert.strictEqual(e1.episodeNumber, 3);

const e2 = parseEpisodeFilename('/media/shows/Stranger.Things.S04E09.The.Piggyback.1080p.mkv');
assert.strictEqual(e2.showTitle, 'Stranger Things');
assert.strictEqual(e2.seasonNumber, 4);
assert.strictEqual(e2.episodeNumber, 9);

// 3. Test ffprobe Analyzer with real sample video
const samplePath = '/home/ubuntu/SmiTriX/brag-output/brag.mp4';
const probeResult = await analyzeMediaFile(samplePath);
assert.strictEqual(probeResult.resolution, '1080p FHD', 'Resolution should be 1080p FHD');
assert.strictEqual(probeResult.videoCodec, 'h264', 'Video codec should be h264');
assert.ok(probeResult.width === 1920, 'Width should be 1920');
assert.ok(probeResult.height === 1080, 'Height should be 1080');
assert.ok(probeResult.durationSeconds > 0, 'Duration should be greater than 0');

// 4. Test Metadata Fetcher with Fallback Resilience
const meta = await fetchMovieMetadata('Interstellar', 2014);
assert.ok(meta.title, 'Should have a title');
assert.ok(meta.posterUrl, 'Should have a poster URL');
assert.ok(meta.rating > 0, 'Should have a rating');

console.log('✅ Scanner & Parser tests passed successfully!');
