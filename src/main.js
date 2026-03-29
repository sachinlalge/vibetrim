import './style.css'

document.addEventListener('DOMContentLoaded', () => {
  // ─── Theme Toggle ──────────────────────────────────────────────
  const themeToggle = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-icon');
  const htmlEl = document.documentElement;

  const savedTheme = localStorage.getItem('theme');
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

  if (savedTheme === 'dark' || (!savedTheme && systemDark)) {
    htmlEl.classList.add('dark');
    htmlEl.classList.remove('light');
    themeIcon.textContent = 'light_mode';
  }

  themeToggle?.addEventListener('click', () => {
    if (htmlEl.classList.contains('dark')) {
      htmlEl.classList.remove('dark');
      htmlEl.classList.add('light');
      themeIcon.textContent = 'dark_mode';
      localStorage.setItem('theme', 'light');
    } else {
      htmlEl.classList.remove('light');
      htmlEl.classList.add('dark');
      themeIcon.textContent = 'light_mode';
      localStorage.setItem('theme', 'dark');
    }
  });

  // ─── Converter State Machine ───────────────────────────────────
  const inputState = document.getElementById('input-state');
  const convertingState = document.getElementById('converting-state');
  const successState = document.getElementById('success-state');

  const convertSubmitBtn = document.getElementById('convert-submit-btn');
  const cancelBtn = document.getElementById('cancel-btn');
  const convertNextBtn = document.getElementById('convert-next-btn');
  const urlInput = document.getElementById('youtube-url-input');

  const progressFill = document.querySelector('.progress-fill');
  const progressTextH2 = document.querySelector('.progress-text h2');
  const progressTextP = document.querySelector('.progress-text p');

  let abortController = null;
  let progressInterval = null;

  function showState(state) {
    inputState.style.display = state === 'input' ? 'block' : 'none';
    convertingState.style.display = state === 'converting' ? 'block' : 'none';
    successState.style.display = state === 'success' ? 'flex' : 'none';
  }

  function resetProgress() {
    progressFill.style.width = '0%';
    if (progressTextH2) progressTextH2.textContent = 'Converting...';
    if (progressTextP) progressTextP.textContent = 'Fetching audio stream...';
  }

  // Helper: force download a blob with correct filename
  function downloadBlob(blob, filename) {
    const blobUrl = URL.createObjectURL(blob);
    const tempLink = document.createElement('a');
    tempLink.style.display = 'none';
    tempLink.href = blobUrl;
    tempLink.download = filename;
    document.body.appendChild(tempLink);
    tempLink.click();
    setTimeout(() => {
      document.body.removeChild(tempLink);
      URL.revokeObjectURL(blobUrl);
    }, 1000);
  }

  // ─── Convert Click ─────────────────────────────────────────────
  convertSubmitBtn?.addEventListener('click', async () => {
    const url = urlInput.value.trim();

    if (!url) {
      alert('Please paste a YouTube URL first!');
      return;
    }

    const ytRegex = /^(https?:\/\/)?(www\.)?(youtube\.com\/(watch\?v=|shorts\/|embed\/)|youtu\.be\/)/;
    if (!ytRegex.test(url)) {
      alert('Please enter a valid YouTube URL.');
      return;
    }

    showState('converting');
    resetProgress();

    const disabledInput = convertingState.querySelector('.disabled-input-field');
    if (disabledInput) disabledInput.value = url;

    abortController = new AbortController();

    try {
      // Step 1: Fetch video info (fast endpoint)
      progressFill.style.width = '10%';
      if (progressTextP) progressTextP.textContent = 'Fetching video info...';

      const infoRes = await fetch(`/api/info?url=${encodeURIComponent(url)}`, {
        signal: abortController.signal,
      });

      if (!infoRes.ok) {
        const errData = await infoRes.json();
        throw new Error(errData.error || 'Failed to fetch video info');
      }

      const info = await infoRes.json();

      progressFill.style.width = '20%';
      if (progressTextH2) progressTextH2.textContent = 'Downloading...';
      if (progressTextP) progressTextP.textContent = `"${info.title}" by ${info.author}`;

      // Step 2: Download + convert (single endpoint)
      let progress = 20;
      progressInterval = setInterval(() => {
        progress += Math.random() * 4;
        if (progress > 90) progress = 90;
        progressFill.style.width = `${progress}%`;
      }, 800);

      const downloadRes = await fetch(`/api/download?url=${encodeURIComponent(url)}`, {
        signal: abortController.signal,
      });

      clearInterval(progressInterval);

      if (!downloadRes.ok) {
        const errData = await downloadRes.json().catch(() => ({}));
        throw new Error(errData.error || 'Download failed.');
      }

      progressFill.style.width = '95%';
      if (progressTextH2) progressTextH2.textContent = 'Finalizing...';

      // Get filename from response headers or construct from info
      const contentDisposition = downloadRes.headers.get('content-disposition') || '';
      let filename = 'vibetrim-audio.mp3';
      const filenameMatch = contentDisposition.match(/filename="?([^";\n]+)"?/);
      if (filenameMatch) {
        filename = filenameMatch[1];
      } else {
        const safeTitle = info.title.replace(/[^a-zA-Z0-9 _\-]/g, '').substring(0, 100);
        filename = `${safeTitle || 'vibetrim-audio'}.mp3`;
      }

      // Get the MP3 blob
      const blob = await downloadRes.blob();
      const mp3Blob = new Blob([blob], { type: 'audio/mpeg' });

      progressFill.style.width = '100%';

      // Read metadata from custom headers
      const bitrate = downloadRes.headers.get('x-bitrate') || info.bitrate || 128;

      // Step 3: Show success state
      setTimeout(() => {
        showState('success');

        const successMeta = document.querySelector('.success-meta');
        if (successMeta) {
          const sizeMB = (mp3Blob.size / (1024 * 1024)).toFixed(1);
          successMeta.textContent = `${bitrate}KBPS • ${sizeMB} MB • MP3`;
        }

        const successTitle = document.querySelector('.success-title');
        if (successTitle) {
          successTitle.textContent = info.title;
        }

        // Wire up download button
        const downloadBtn = document.getElementById('download-btn');
        downloadBtn.onclick = () => {
          downloadBlob(mp3Blob, filename);
        };
      }, 400);

    } catch (err) {
      clearInterval(progressInterval);

      if (err.name === 'AbortError') {
        showState('input');
        return;
      }

      console.error('Conversion error:', err);
      alert(`Error: ${err.message}`);
      showState('input');
    }
  });

  // ─── Cancel ────────────────────────────────────────────────────
  cancelBtn?.addEventListener('click', () => {
    if (abortController) abortController.abort();
    clearInterval(progressInterval);
    showState('input');
    resetProgress();
  });

  // ─── Convert Next ──────────────────────────────────────────────
  convertNextBtn?.addEventListener('click', () => {
    showState('input');
    urlInput.value = '';
    resetProgress();
  });

  // ─── Enter key ─────────────────────────────────────────────────
  urlInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      convertSubmitBtn?.click();
    }
  });
});
