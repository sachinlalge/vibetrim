import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import https from 'https';
import ffmpegPath from 'ffmpeg-static';

import os from 'os';

const execFileAsync = promisify(execFile);

// yt-dlp binary path in tmp (writable in serverless)
const isWin = os.platform() === 'win32';
const YTDLP_PATH = path.join(os.tmpdir(), isWin ? 'yt-dlp.exe' : 'yt-dlp');

/**
 * Download yt-dlp binary if it doesn't exist in tmp
 */
async function ensureYtDlp() {
  if (fs.existsSync(YTDLP_PATH)) {
    return YTDLP_PATH;
  }

  console.log('⬇ Downloading yt-dlp binary...');
  let url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux';
  if (isWin) {
    url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe';
  } else if (os.platform() === 'darwin') {
    url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos';
  }

  await new Promise((resolve, reject) => {
    const download = (downloadUrl) => {
      https.get(downloadUrl, (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          // Follow redirect
          download(res.headers.location);
          return;
        }
        const file = fs.createWriteStream(YTDLP_PATH);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          fs.chmodSync(YTDLP_PATH, 0o755);
          console.log('✔ yt-dlp downloaded');
          resolve();
        });
        file.on('error', reject);
      }).on('error', reject);
    };
    download(url);
  });

  return YTDLP_PATH;
}

/**
 * Get ffmpeg path (from ffmpeg-static npm package)
 */
function getFfmpegPath() {
  return ffmpegPath;
}

/**
 * Validate YouTube URL
 */
function isValidYouTubeURL(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)/.test(url);
}

export { ensureYtDlp, getFfmpegPath, isValidYouTubeURL, execFileAsync };
