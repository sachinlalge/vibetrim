const https = require('https');
https.get('https://ytdowload-ecru.vercel.app/api/info?url=https://www.youtube.com/watch?v=jNQXAC9IVRw', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('RESPONSE:', data));
});
