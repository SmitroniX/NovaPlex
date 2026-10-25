import path from 'node:path';

/**
 * Clean up title strings by removing common release tags, dots, underscores, brackets
 */
function cleanString(str) {
  if (!str) return '';
  return str
    .replace(/[\._]/g, ' ')
    .replace(/\[.*?\]|\(.*?\)/g, (match) => {
      // Keep 4-digit years in parentheses if needed, but strip them in final clean
      return match.match(/\b(19\d\d|20\d\d)\b/) ? match : '';
    })
    .replace(/\b(2160p|1080p|720p|480p|4k|uhd|fhd|bluray|blu-ray|web-dl|webrip|remux|hdr10\+|hdr10|hdr|dv|dolby vision|dts|aac|ac3|hevc|x265|x264|h264|h265|atmos|truehd)\b/gi, '')
    .replace(/[\(\)\[\]\{\}\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse movie filename or path
 */
export function parseMovieFilename(filePath) {
  const parsed = path.parse(filePath);
  const filename = parsed.name;

  // Pattern 1: Title (Year) or Title.Year
  const yearMatch = filename.match(/[\.\s\(\[\_](19\d\d|20\d\d)[\.\s\)\]\_]?/);
  let year = null;
  let title = filename;

  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
    const yearIndex = filename.indexOf(yearMatch[0]);
    if (yearIndex > 0) {
      title = filename.substring(0, yearIndex);
    }
  }

  // Fallback: check parent directory if filename is just 'movie' or 'cd1'
  if (title.toLowerCase() === 'movie' || title.toLowerCase().startsWith('cd')) {
    const parentDir = path.basename(parsed.dir);
    const parentYearMatch = parentDir.match(/[\.\s\(\[\_](19\d\d|20\d\d)[\.\s\)\]\_]?/);
    if (parentYearMatch) {
      year = parseInt(parentYearMatch[1], 10);
      title = parentDir.substring(0, parentDir.indexOf(parentYearMatch[0]));
    } else {
      title = parentDir;
    }
  }

  title = cleanString(title);

  return {
    type: 'movie',
    title: title || cleanString(filename),
    year: year || null,
    filename: parsed.base
  };
}

/**
 * Parse TV episode filename or path
 */
export function parseEpisodeFilename(filePath, titleTag = '') {
  const parsed = path.parse(filePath);
  let filename = parsed.name;

  // If filename looks like a hash / uuid and titleTag is provided, use titleTag
  const isHashName = /^[0-9a-fA-F\-]{16,}$/.test(filename) || filename.toLowerCase().startsWith('tmp');
  if (isHashName && titleTag) {
    filename = titleTag;
  }

  const parentDir = path.basename(parsed.dir);
  const grandParentDir = path.basename(path.dirname(parsed.dir));

  let showTitle = '';
  let seasonNumber = 1;
  let episodeNumber = 1;
  let episodeTitle = '';

  // Match S01E02 or s1e2 or 1x02 in filename or titleTag
  let seMatch = filename.match(/(?:[sS](\d{1,2})[\.\s\-_]*[eE](\d{1,3}))|(\d{1,2})x(\d{1,3})/i);
  if (!seMatch && titleTag) {
    seMatch = titleTag.match(/(?:[sS](\d{1,2})[\.\s\-_]*[eE](\d{1,3}))|(\d{1,2})x(\d{1,3})/i);
    if (seMatch) filename = titleTag;
  }

  if (seMatch) {
    if (seMatch[1] && seMatch[2]) {
      seasonNumber = parseInt(seMatch[1], 10);
      episodeNumber = parseInt(seMatch[2], 10);
    } else if (seMatch[3] && seMatch[4]) {
      seasonNumber = parseInt(seMatch[3], 10);
      episodeNumber = parseInt(seMatch[4], 10);
    }

    const matchIndex = filename.indexOf(seMatch[0]);
    if (matchIndex > 0) {
      showTitle = cleanString(filename.substring(0, matchIndex));
    }

    const afterSe = filename.substring(matchIndex + seMatch[0].length);
    episodeTitle = cleanString(afterSe);
  } else {
    // Check if filename has simple episode number: Ep 01, Episode 1, 01 - Title
    const epOnlyMatch = filename.match(/(?:ep(?:isode)?[\s\-_]*)(\d{1,3})/i);
    if (epOnlyMatch) {
      episodeNumber = parseInt(epOnlyMatch[1], 10);
    }
  }

  // Derive Show title from directory structure if not found in filename
  if (!showTitle) {
    // If parent directory is "Season 1", "Season 02", use grandParentDir as show title
    const seasonDirMatch = parentDir.match(/season[\s\-_]*(\d{1,2})/i);
    if (seasonDirMatch) {
      seasonNumber = parseInt(seasonDirMatch[1], 10);
      showTitle = cleanString(grandParentDir);
    } else {
      showTitle = cleanString(parentDir);
    }
  }

  return {
    type: 'show',
    showTitle: showTitle || 'Unknown Show',
    seasonNumber: seasonNumber || 1,
    episodeNumber: episodeNumber || 1,
    episodeTitle: episodeTitle || `Episode ${episodeNumber}`,
    filename: parsed.base
  };
}
