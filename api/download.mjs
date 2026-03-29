import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import ytdl from '@distube/ytdl-core';
import ffmpegPath from 'ffmpeg-static';
import { spawn } from 'child_process';
import { isValidYouTubeURL } from './_utils.mjs';

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url || !isValidYouTubeURL(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  const fileId = crypto.randomBytes(8).toString('hex');
  const tmpDir = os.tmpdir();
  const filepath = path.join(tmpDir, `${fileId}.mp3`);

  try {
    const info = await ytdl.getInfo(url);
    const title = (info.videoDetails.title || 'vibetrim-audio')
      .replace(/[^a-zA-Z0-9 _\-()]/g, '')
      .substring(0, 100)
      .trim();

    const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
    const bitrate = format ? format.audioBitrate || 128 : 128;

    console.log(`⬇ Downloading: "${info.videoDetails.title}"`);

    const audioStream = ytdl.downloadFromInfo(info, { format });

    await new Promise((resolve, reject) => {
      const ffmpegProcess = spawn(ffmpegPath, [
        '-i', 'pipe:3',
        '-f', 'mp3',
        '-b:a', `${bitrate}k`,
        filepath
      ], {
        stdio: ['ignore', 'ignore', 'ignore', 'pipe']
      });

      audioStream.pipe(ffmpegProcess.stdio[3]);

      ffmpegProcess.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${code}`));
      });
      ffmpegProcess.on('error', reject);
      audioStream.on('error', reject);
    });

    const stat = fs.statSync(filepath);
    const filename = `${title}.mp3`;

    console.log(`✔ Converted: ${filename} (${(stat.size / (1024 * 1024)).toFixed(1)} MB)`);

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Title', encodeURIComponent(info.videoDetails.title));
    res.setHeader('X-Author', encodeURIComponent(info.videoDetails.author.name));
    res.setHeader('X-Bitrate', String(Math.round(bitrate)));
    res.setHeader('X-Filename', encodeURIComponent(filename));
    res.setHeader('Access-Control-Expose-Headers', 'X-Title, X-Author, X-Bitrate, X-Filename, Content-Disposition');

    const readStream = fs.createReadStream(filepath);
    readStream.pipe(res);

    readStream.on('end', () => {
      try { fs.unlinkSync(filepath); } catch (_) {}
    });

  } catch (err) {
    console.error('Download error:', err.message);
    try { fs.unlinkSync(filepath); } catch (_) {}
    if (!res.headersSent) {
      res.status(500).json({ error: 'Conversion failed. ' + err.message });
    }
  }
}
