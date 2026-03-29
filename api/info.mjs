import ytdl from '@distube/ytdl-core';
import { isValidYouTubeURL } from './_utils.mjs';

export default async function handler(req, res) {
  const { url } = req.query;

  if (!url || !isValidYouTubeURL(url)) {
    return res.status(400).json({ error: 'Invalid YouTube URL' });
  }

  try {
    const info = await ytdl.getInfo(url);
    const format = ytdl.chooseFormat(info.formats, { quality: 'highestaudio' });
    
    res.json({
      title: info.videoDetails.title || 'Unknown',
      author: info.videoDetails.author.name || 'Unknown',
      duration: parseInt(info.videoDetails.lengthSeconds, 10) || 0,
      thumbnail: info.videoDetails.thumbnails.length ? info.videoDetails.thumbnails[0].url : '',
      bitrate: format ? format.audioBitrate || 128 : 128,
      filesize: format && format.contentLength ? parseInt(format.contentLength, 10) : null,
    });
  } catch (err) {
    console.error('Info error:', err.message);
    res.status(500).json({ error: 'Failed to fetch video info.', details: err.message });
  }
}
