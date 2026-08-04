/**
 * Folder Scanner & Batch Queue Manager
 * Traverses file trees (Drag & Drop, WebKitDirectory, File System Access API)
 * Detects video files, sidecar subtitle files (.srt, .vtt, .ass), and correlates them.
 *
 * KEY IMPROVEMENT: Two-phase audio-targeted hardsub detection.
 * Phase 1: Connects the video element to Web Audio API AnalyserNode, seeks to 20
 *          candidate timestamps, plays 100ms each, measures speech-frequency amplitude,
 *          and selects the loudest moments (most likely dialogue/subtitles).
 * Phase 2: Seeks to those audio-targeted timestamps and analyzes frames visually
 *          for subtitle text (white/yellow/cyan + border/shadow contrast).
 *
 * This avoids the previous problem of sampling timestamps that land on silent
 * scenes (intros, action montages, credits) where no subtitle text is visible.
 */
class MediaScanner {
  constructor() {
    this.videoExtensions = new Set(['mkv', 'mp4', 'm4v', 'avi', 'webm', 'ts', 'mov']);
    this.subExtensions = new Set(['srt', 'ass', 'vtt', 'sub', 'idx', 'sup']);
  }

  isVideoFile(file) {
    if (!file || !file.name) return false;
    const ext = file.name.split('.').pop().toLowerCase();
    return this.videoExtensions.has(ext);
  }

  isSubtitleFile(file) {
    if (!file || !file.name) return false;
    const ext = file.name.split('.').pop().toLowerCase();
    return this.subExtensions.has(ext);
  }

  isSupportedFile(file) {
    return this.isVideoFile(file) || this.isSubtitleFile(file);
  }

  processFileList(fileList) {
    const videoFiles = [];
    const subtitleFiles = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (this.isVideoFile(file)) videoFiles.push(file);
      else if (this.isSubtitleFile(file)) subtitleFiles.push(file);
    }
    return { videoFiles, subtitleFiles };
  }

  async processDataTransferItems(items) {
    const videoFiles = [];
    const subtitleFiles = [];
    const entries = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry) {
          entries.push(entry);
        } else {
          const file = item.getAsFile();
          if (file && this.isVideoFile(file)) videoFiles.push(file);
          else if (file && this.isSubtitleFile(file)) subtitleFiles.push(file);
        }
      }
    }

    for (const entry of entries) {
      const res = await this.readFileSystemEntry(entry);
      videoFiles.push(...res.videoFiles);
      subtitleFiles.push(...res.subtitleFiles);
    }

    return { videoFiles, subtitleFiles };
  }

  async readFileSystemEntry(entry, pathPrefix = '') {
    const videoFiles = [];
    const subtitleFiles = [];

    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((file) => {
          file.relativePath = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
          if (this.isVideoFile(file)) videoFiles.push(file);
          else if (this.isSubtitleFile(file)) subtitleFiles.push(file);
          resolve({ videoFiles, subtitleFiles });
        }, () => resolve({ videoFiles, subtitleFiles }));
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const readEntries = () => {
        return new Promise((resolve) => {
          dirReader.readEntries(async (subEntries) => {
            if (subEntries.length === 0) {
              resolve({ videoFiles, subtitleFiles });
            } else {
              const currentPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
              for (const subEntry of subEntries) {
                const subRes = await this.readFileSystemEntry(subEntry, currentPath);
                videoFiles.push(...subRes.videoFiles);
                subtitleFiles.push(...subRes.subtitleFiles);
              }
              const more = await readEntries();
              videoFiles.push(...more.videoFiles);
              subtitleFiles.push(...more.subtitleFiles);
              resolve({ videoFiles, subtitleFiles });
            }
          }, () => resolve({ videoFiles, subtitleFiles }));
        });
      };
      return await readEntries();
    }
    return { videoFiles, subtitleFiles };
  }

  async pickDirectory() {
    if (typeof window.showDirectoryPicker !== 'function') return null;
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      this.rootDirectoryHandle = dirHandle;
      const videoFiles = [];
      const subtitleFiles = [];
      await this.traverseDirectoryHandle(dirHandle, dirHandle.name, videoFiles, subtitleFiles);
      return { videoFiles, subtitleFiles, rootDirectoryHandle: dirHandle };
    } catch (err) {
      if (err.name !== 'AbortError') console.warn('Directory picker error:', err);
      return null;
    }
  }

  async traverseDirectoryHandle(dirHandle, currentPath, videoFiles, subtitleFiles) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        file.relativePath = `${currentPath}/${file.name}`;
        file.fileHandle = entry;
        file.parentDirHandle = dirHandle;
        if (this.isVideoFile(file)) videoFiles.push(file);
        else if (this.isSubtitleFile(file)) subtitleFiles.push(file);
      } else if (entry.kind === 'directory') {
        await this.traverseDirectoryHandle(entry, `${currentPath}/${entry.name}`, videoFiles, subtitleFiles);
      }
    }
  }

  getFileStem(filename) {
    if (!filename) return '';
    let stem = filename.substring(0, filename.lastIndexOf('.')) || filename;
    stem = stem.replace(/\.(en|ar|ara|eng|fre|fra|spa|ger|deu|ita|rus|zho|chi|jpn|kor)$/i, '');
    return stem.toLowerCase().trim();
  }

  // ================================================================
  // PHASE 1: AUDIO ACTIVITY SAMPLER
  // Connects video element to AudioContext AnalyserNode, plays 100ms
  // at each of 20 candidate timestamps, and measures speech-frequency
  // amplitude. Returns the loudest timestamps (most likely dialogue).
  //
  // Why this works: Browser's video decoder is responsible for
  // demuxing the container and decoding the audio, so we get accurate
  // per-timestamp audio levels without needing raw file parsing.
  // ================================================================
  async _getDialogueTimestamps(objectUrl, duration) {
    const CANDIDATE_COUNT = 20;
    const PLAY_DURATION_MS = 100;   // play 100ms at each position to fill analyser
    const MIN_GAP_SECONDS = 8;      // minimum spacing between selected timestamps
    const MAX_SELECTED = 12;        // final number of timestamps to pass to visual phase

    // Build evenly-spaced candidate list from 8% to 87% of duration
    const candidates = Array.from({ length: CANDIDATE_COUNT }, (_, i) =>
      duration * (0.08 + (0.79 * i / (CANDIDATE_COUNT - 1)))
    );

    return new Promise((resolve) => {
      const audioVideo = document.createElement('video');
      audioVideo.preload = 'auto';
      audioVideo.src = objectUrl;

      // Timeout the entire audio phase at 10 seconds
      const audioPhaseTimer = setTimeout(() => {
        audioVideo.removeAttribute('src');
        audioVideo.load();
        resolve([]);
      }, 10000);

      audioVideo.onerror = () => {
        clearTimeout(audioPhaseTimer);
        resolve([]);
      };

      audioVideo.onloadedmetadata = async () => {
        let audioCtx = null;
        let analyser = null;
        const samples = []; // { time, level }

        try {
          audioCtx = new (window.AudioContext || window.webkitAudioContext)();

          // Resume AudioContext if suspended (browser policy)
          if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
          }

          analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512; // frequencyBinCount = 256

          // GainNode at 0 — processes audio for analysis but makes no sound
          const gainNode = audioCtx.createGain();
          gainNode.gain.value = 0;

          const source = audioCtx.createMediaElementSource(audioVideo);
          source.connect(analyser);
          analyser.connect(gainNode);
          gainNode.connect(audioCtx.destination);

          const freqData = new Uint8Array(analyser.frequencyBinCount);

          for (const t of candidates) {
            await new Promise((seekDone) => {
              audioVideo.onseeked = async () => {
                try {
                  await audioVideo.play();
                  await new Promise(r => setTimeout(r, PLAY_DURATION_MS));
                  audioVideo.pause();

                  analyser.getByteFrequencyData(freqData);

                  // Focus on speech-frequency range: ~86Hz to ~4kHz
                  // With fftSize=512 @ ~44100Hz sample rate:
                  // bin index i ≈ i * 44100 / 512 ≈ i * 86 Hz
                  // bin 1 = ~86Hz, bin 46 = ~3.9kHz
                  let speechSum = 0;
                  for (let i = 1; i <= 46; i++) speechSum += freqData[i];
                  const speechLevel = speechSum / 46;

                  samples.push({ time: t, level: speechLevel });
                } catch (playErr) {
                  // play() blocked by autoplay policy or seek failed — record 0
                  samples.push({ time: t, level: 0 });
                }
                seekDone();
              };
              audioVideo.currentTime = t;
            });
          }

          try { audioCtx.close(); } catch (e) {}
        } catch (contextErr) {
          // AudioContext creation or MediaElementSource failed
          if (audioCtx) try { audioCtx.close(); } catch (e) {}
        }

        clearTimeout(audioPhaseTimer);
        audioVideo.removeAttribute('src');
        audioVideo.load();

        // If all levels are 0 (autoplay blocked), signal fallback needed
        const allZero = samples.every(s => s.level === 0);
        if (samples.length === 0 || allZero) {
          resolve([]);
          return;
        }

        // Sort by speech amplitude descending (loudest = most likely talking)
        samples.sort((a, b) => b.level - a.level);

        // De-duplicate: keep timestamps at least MIN_GAP_SECONDS apart
        const selected = [];
        for (const s of samples) {
          const tooClose = selected.some(t => Math.abs(t - s.time) < MIN_GAP_SECONDS);
          if (!tooClose) selected.push(s.time);
          if (selected.length >= MAX_SELECTED) break;
        }

        // Sort chronologically for efficient seeking (no backward jumps)
        selected.sort((a, b) => a - b);
        resolve(selected);
      };
    });
  }

  // ================================================================
  // PHASE 2: VISUAL FRAME SUBTITLE DETECTOR
  // Seeks a muted video element to the given timestamps, captures
  // canvas frames, and checks the bottom 18% of each frame for
  // characteristic hardsub text (bright pixels with dark contrast edge).
  // ================================================================
  _analyzeFramesVisually(objectUrl, sampleTimes, onDone) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = objectUrl;

    let capturedDataUrl = null;
    let maxScore = -1;

    const finish = (hasHardsubs) => {
      video.removeAttribute('src');
      video.load();
      onDone({ hasHardsubs, confidence: hasHardsubs ? 0.95 : 0.80, frameDataUrl: capturedDataUrl });
    };

    video.onerror = () => finish(false);

    video.onloadedmetadata = () => {
      const duration = video.duration || 600;

      // Clamp and deduplicate timestamps
      let times = sampleTimes
        .map(t => Math.max(2, Math.min(t, duration - 3)))
        .filter((t, i, arr) => i === 0 || Math.abs(arr[i - 1] - t) > 1);

      if (times.length === 0) times = [duration * 0.3];

      let idx = 0;
      let detectedCount = 0;

      const analyzeFrame = () => {
        try {
          const canvas = document.createElement('canvas');
          const w = video.videoWidth || 640;
          const h = video.videoHeight || 360;
          canvas.width = w;
          canvas.height = h;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, w, h);

          // Subtitle zone: bottom 18% of frame (80%–98% height)
          const subY = Math.floor(h * 0.80);
          const subH = Math.floor(h * 0.18);
          const imgData = ctx.getImageData(0, subY, w, subH);
          const px = imgData.data;
          const totalPx = w * subH;

          let textCount = 0;
          let borderCount = 0;
          let shadowCount = 0;

          for (let i = 0; i < px.length - 8; i += 4) {
            const r = px[i], g = px[i + 1], b = px[i + 2];

            // Common hardsub text colors
            const isWhite  = r > 200 && g > 200 && b > 200;
            const isYellow = r > 190 && g > 175 && b < 140;
            const isCyan   = r < 110 && g > 195 && b > 195;

            if (isWhite || isYellow || isCyan) {
              textCount++;
              const nr = px[i + 4], ng = px[i + 5], nb = px[i + 6];
              if (nr < 70 && ng < 70 && nb < 70) borderCount++;       // hard outline
              else if (nr < 140 && ng < 140 && nb < 140) shadowCount++; // soft shadow
            }
          }

          const textRatio   = textCount  / totalPx;
          const borderRatio = borderCount / totalPx;
          const shadowRatio = shadowCount / totalPx;
          const score = (borderRatio * 10) + (shadowRatio * 3) + textRatio;

          if (score > maxScore || !capturedDataUrl) {
            maxScore = score;
            try { capturedDataUrl = canvas.toDataURL('image/jpeg', 0.82); } catch (e) {}
          }

          // Positive detection: bright text present AND dark-contrast neighbor
          if (textRatio > 0.002 && (borderRatio > 0.0004 || shadowRatio > 0.001)) {
            detectedCount++;
          }

          idx++;
          if (idx < times.length) {
            video.currentTime = times[idx];
          } else {
            finish(detectedCount >= 1);
          }
        } catch (err) {
          finish(false);
        }
      };

      video.onseeked = analyzeFrame;
      video.currentTime = times[0];
    };
  }

  // ================================================================
  // PUBLIC: COMBINED AUDIO+VISUAL HARDSUB ANALYSIS
  // ================================================================
  async analyzeVideoFrameSubtitles(file) {
    return new Promise((resolve) => {
      if (!file || !file.size) {
        return resolve({ hasHardsubs: false, confidence: 0, frameDataUrl: null });
      }

      const objectUrl = URL.createObjectURL(file);
      let settled = false;

      const done = (result) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(objectUrl);
        resolve(result);
      };

      // Hard outer timeout — 15 seconds total
      const masterTimer = setTimeout(() => done({ hasHardsubs: false, confidence: 0.4, frameDataUrl: null }), 15000);

      // Quick metadata read to get duration for fallback timestamps
      const metaVideo = document.createElement('video');
      metaVideo.preload = 'metadata';
      metaVideo.src = objectUrl;

      metaVideo.onerror = () => {
        clearTimeout(masterTimer);
        done({ hasHardsubs: false, confidence: 0.4, frameDataUrl: null });
      };

      metaVideo.onloadedmetadata = async () => {
        const duration = metaVideo.duration || 600;
        metaVideo.removeAttribute('src');
        metaVideo.load();

        // Fallback: 15 evenly-spaced timestamps (vs original 8) for better coverage
        const fallbackTimes = Array.from({ length: 15 }, (_, i) =>
          duration * (0.07 + (0.83 * i / 14))
        );

        // Phase 1: Try audio-targeted timestamp selection
        let targetTimes = [];
        try {
          targetTimes = await this._getDialogueTimestamps(objectUrl, duration);
        } catch (e) {
          targetTimes = [];
        }

        const sampleTimes = targetTimes.length >= 4 ? targetTimes : fallbackTimes;

        // Phase 2: Visual frame analysis on chosen timestamps
        this._analyzeFramesVisually(objectUrl, sampleTimes, (result) => {
          clearTimeout(masterTimer);
          done(result);
        });
      };
    });
  }

  /**
   * Execute batch scan with live progress updates & audio-targeted multi-frame analysis
   */
  async scanBatch(scanData, onProgress, onFileComplete) {
    const videoFiles = scanData.videoFiles || (Array.isArray(scanData) ? scanData : []);
    const subtitleFiles = scanData.subtitleFiles || [];
    const results = [];
    const total = videoFiles.length;

    const sidecarMap = new Map();
    subtitleFiles.forEach(subFile => {
      const stem = this.getFileStem(subFile.name);
      if (!sidecarMap.has(stem)) sidecarMap.set(stem, []);
      sidecarMap.get(stem).push(subFile.name);
    });

    for (let i = 0; i < total; i++) {
      const file = videoFiles[i];
      const percent = Math.round(((i + 1) / total) * 100);

      if (onProgress) {
        onProgress({
          currentIndex: i + 1,
          totalFiles: total,
          percent: percent,
          currentFileName: file.name
        });
      }

      const analysis = await window.mediaInfoEngine.analyzeFile(file);

      const stem = this.getFileStem(file.name);
      const sidecarSubs = sidecarMap.get(stem) || [];

      const allSubs = (analysis && analysis.subtitles) ? analysis.subtitles : [];
      const fullSoftTracks = allSubs.filter(s => !s.isForced && !/(forced|foreign|partial|narrative)/i.test(s.title || ''));
      const hasFullSoft = fullSoftTracks.length > 0;

      // Two-phase audio-targeted visual hardsub analysis
      const visualRes = await this.analyzeVideoFrameSubtitles(file);

      const subStatus = visualRes.hasHardsubs ? 'has-subs' : 'no-subs';

      const mediaRecord = {
        id: `media_${Date.now()}_${i}`,
        file: file,
        fileName: file.name,
        filePath: file.webkitRelativePath || file.relativePath || file.name,
        fileSize: file.size,
        fileSizeFormatted: this.formatBytes(file.size),
        analysis: analysis,
        subStatus: subStatus,
        sidecarSubs: sidecarSubs,
        thumbnailDataUrl: visualRes.frameDataUrl,
        hasHardsubs: visualRes.hasHardsubs
      };

      results.push(mediaRecord);
      if (onFileComplete) onFileComplete(mediaRecord);
    }

    return results;
  }

  formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }
}

window.mediaScanner = new MediaScanner();
