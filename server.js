import express from 'express';
import cors from 'cors';
import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import https from 'https';
import ffmpegPath from 'ffmpeg-static';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const isWin = os.platform() === 'win32';
const YTDLP = path.join(os.tmpdir(), isWin ? 'yt-dlp.exe' : 'yt-dlp');
const FFMPEG = ffmpegPath;

const DOWNLOADS_DIR = path.join(os.tmpdir(), 'vibetrim-downloads');

if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

const execFileAsync = promisify(execFile);

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : '*';

// Enable CORS for frontend (e.g. Vercel)
app.use(cors({
  origin: ALLOWED_ORIGINS, // Adjust this to your specific Vercel frontend domain in production if needed
  methods: ['GET', 'POST', 'OPTIONS'],
}));
app.use(express.json());

// Download yt-dlp properly based on the environment (important for Railway/Linux)
async function ensureYtDlp() {
  if (fs.existsSync(YTDLP)) return YTDLP;
  
  console.log('⬇ Downloading right yt-dlp binary for this OS...');
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
          download(res.headers.location);
          return;
        }
        const file = fs.createWriteStream(YTDLP);
        res.pipe(file);
        file.on('finish', () => {
          file.close();
          if (!isWin) fs.chmodSync(YTDLP, 0o755);
          console.log('✔ yt-dlp downloaded securely!');
          resolve();
        });
        file.on('error', reject);
      }).on('error', reject);
    };
    download(url);
  });
  return YTDLP;
}

// In-memory store of prepared files (fileId → { filepath, filename, createdAt })
const preparedFiles = new Map();

// Clean up old files every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of preparedFiles) {
    if (now - entry.createdAt > 10 * 60 * 1000) { // 10 minutes
      try { fs.unlinkSync(entry.filepath); } catch (_) {}
      preparedFiles.delete(id);
    }
  }
}, 5 * 60 * 1000);

function isValidYouTubeURL(url) {
  return /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)/.test(url);
}

// ─── GET /api/info ─────────────────────────────────────────────────
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url || !isValidYouTubeURL(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  try {
    await ensureYtDlp();
    const { stdout } = await execFileAsync(YTDLP, [
      '--dump-json', '--no-warnings', '--no-playlist',
      '--extractor-args', 'youtube:player_client=android,web', // Fallback arg to bypass some bot checks
      '--ffmpeg-location', FFMPEG, url,
    ], { timeout: 30000 });

    const info = JSON.parse(stdout);
    const audioFormats = (info.formats || [])
      .filter(f => f.vcodec === 'none' && f.acodec !== 'none')
      .sort((a, b) => (b.abr || 0) - (a.abr || 0));
    const bestAudio = audioFormats[0] || {};

    res.json({
      title: info.title || 'Unknown',
      author: info.uploader || info.channel || 'Unknown',
      duration: info.duration || 0,
      thumbnail: info.thumbnail || '',
      bitrate: Math.round(bestAudio.abr || 128),
      filesize: bestAudio.filesize || bestAudio.filesize_approx || null,
    });
  } catch (err) {
    console.error('Info error:', err.message);
    const errorMessage = err.message.includes('Sign in to confirm') || err.message.includes('bot') 
      ? 'YouTube blocked the request (Bot protection). Please try again or use a proxy.' 
      : 'Failed to fetch video info.';
    res.status(500).json({ error: errorMessage, details: err.message });
  }
});

// ─── GET /api/prepare ──────────────────────────────────────────────
app.get('/api/prepare', async (req, res) => {
  const { url } = req.query;
  if (!url || !isValidYouTubeURL(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  const fileId = crypto.randomBytes(8).toString('hex');
  const outputTemplate = path.join(DOWNLOADS_DIR, `${fileId}.%(ext)s`);

  try {
    await ensureYtDlp();
    // Get video info for the title
    const { stdout: jsonStr } = await execFileAsync(YTDLP, [
      '--dump-json', '--no-warnings', '--no-playlist',
      '--extractor-args', 'youtube:player_client=android,web',
      '--ffmpeg-location', FFMPEG, url,
    ], { timeout: 30000 });

    const info = JSON.parse(jsonStr);
    const safeTitle = (info.title || 'vibetrim-audio')
      .replace(/[^a-zA-Z0-9 _\-()]/g, '')
      .substring(0, 100)
      .trim();

    console.log(`⬇ Downloading: "${info.title}"`);

    // Download + convert to MP3
    await execFileAsync(YTDLP, [
      '--no-warnings', '--no-playlist',
      '-f', 'bestaudio',
      '--extractor-args', 'youtube:player_client=android,web',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--ffmpeg-location', FFMPEG,
      '-o', outputTemplate,
      url,
    ], { timeout: 180000 }); // 3 minutes timeout for Railway

    // Find the resulting MP3 file
    const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.startsWith(fileId));
    if (files.length === 0) throw new Error('File not found after conversion');

    const filepath = path.join(DOWNLOADS_DIR, files[0]);
    const stat = fs.statSync(filepath);
    const filename = `${safeTitle}.mp3`;

    console.log(`✔ Converted: ${filename} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)`);

    preparedFiles.set(fileId, {
      filepath,
      filename,
      createdAt: Date.now(),
    });

    res.json({
      fileId,
      filename,
      filesize: stat.size,
    });

  } catch (err) {
    console.error('Prepare error:', err.message);
    const errorMessage = err.message.includes('Sign in to confirm') || err.message.includes('bot') 
      ? 'YouTube blocked the request (Bot protection). Please try again or use a proxy.' 
      : 'Conversion failed.';
      
    try {
      fs.readdirSync(DOWNLOADS_DIR)
        .filter(f => f.startsWith(fileId))
        .forEach(f => fs.unlinkSync(path.join(DOWNLOADS_DIR, f)));
    } catch (_) {}
    if (!res.headersSent) {
      res.status(500).json({ error: errorMessage, details: err.message });
    }
  }
});

// ─── GET /api/download ─────────────────────────────────────────────
// Stream directly without preparing link! (Matches the Vercel architecture but on Express)
app.get('/api/download', async (req, res) => {
  const { url } = req.query;
  if (!url || !isValidYouTubeURL(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  const fileId = crypto.randomBytes(8).toString('hex');
  const outputTemplate = path.join(DOWNLOADS_DIR, `${fileId}.%(ext)s`);

  try {
    await ensureYtDlp();
    const { stdout: jsonStr } = await execFileAsync(YTDLP, [
      '--dump-json', '--no-warnings', '--no-playlist',
      '--extractor-args', 'youtube:player_client=android,web',
      '--ffmpeg-location', FFMPEG, url,
    ], { timeout: 30000 });

    const info = JSON.parse(jsonStr);
    const safeTitle = (info.title || 'vibetrim-audio')
      .replace(/[^a-zA-Z0-9 _\-()]/g, '')
      .substring(0, 100)
      .trim();

    console.log(`⬇ Downloading & Converting stream: "${info.title}"`);

    await execFileAsync(YTDLP, [
      '--no-warnings', '--no-playlist',
      '-f', 'bestaudio',
      '--extractor-args', 'youtube:player_client=android,web',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '--ffmpeg-location', FFMPEG,
      '-o', outputTemplate,
      url,
    ], { timeout: 180000 }); 

    const files = fs.readdirSync(DOWNLOADS_DIR).filter(f => f.startsWith(fileId));
    if (files.length === 0) throw new Error('File not found after conversion');

    const filepath = path.join(DOWNLOADS_DIR, files[0]);
    const stat = fs.statSync(filepath);
    const filename = `${safeTitle}.mp3`;
    
    const audioFormats = (info.formats || [])
      .filter(f => f.vcodec === 'none' && f.acodec !== 'none')
      .sort((a, b) => (b.abr || 0) - (a.abr || 0));
    const bestAudio = audioFormats[0] || {};

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Title', encodeURIComponent(info.title));
    res.setHeader('X-Author', encodeURIComponent(info.uploader || info.channel || 'Unknown'));
    res.setHeader('X-Bitrate', String(Math.round(bestAudio.abr || 128)));
    res.setHeader('X-Filename', encodeURIComponent(filename));
    res.setHeader('Access-Control-Expose-Headers', 'X-Title, X-Author, X-Bitrate, X-Filename, Content-Disposition');

    const readStream = fs.createReadStream(filepath);
    readStream.pipe(res);

    readStream.on('end', () => {
      try { fs.unlinkSync(filepath); } catch (_) {}
    });

  } catch (err) {
    console.error('Download error:', err.message);
    try {
      fs.readdirSync(DOWNLOADS_DIR)
        .filter(f => f.startsWith(fileId))
        .forEach(f => fs.unlinkSync(path.join(DOWNLOADS_DIR, f)));
    } catch (_) {}
    if (!res.headersSent) {
      const errorMessage = err.message.includes('bot') ? 'YouTube Blocked: Try Proxy' : 'Conversion failed.';
      res.status(500).json({ error: errorMessage, details: err.message });
    }
  }
});

// ─── GET /api/file/:fileId ─────────────────────────────────────────
app.get('/api/file/:fileId', (req, res) => {
  const { fileId } = req.params;
  const entry = preparedFiles.get(fileId);

  if (!entry || !fs.existsSync(entry.filepath)) {
    return res.status(404).json({ error: 'File not found or expired.' });
  }

  const stat = fs.statSync(entry.filepath);

  res.setHeader('Content-Type', 'audio/mpeg');
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Disposition', `attachment; filename="${entry.filename}"`);

  const readStream = fs.createReadStream(entry.filepath);
  readStream.pipe(res);

  readStream.on('end', () => {
    try { fs.unlinkSync(entry.filepath); } catch (_) {}
    preparedFiles.delete(fileId);
  });

  readStream.on('error', (err) => {
    console.error('File stream error:', err.message);
    if (!res.headersSent) res.status(500).json({ error: 'Error streaming file' });
  });
});

// Startup the server
app.listen(PORT, async () => {
  console.log(`✔ VibeTrim backend running on http://localhost:${PORT}`);
  console.log(`  ffmpeg:  ${FFMPEG}`);
  console.log(`  Temp:    ${DOWNLOADS_DIR}`);
  await ensureYtDlp(); // Prefetch yt-dlp binary on boot for faster first request
});
