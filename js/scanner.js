/**
 * Folder Scanner & Batch Queue Manager
 * Traverses file trees (Drag & Drop, WebKitDirectory, File System Access API)
 * Detects video files, sidecar subtitle files (.srt, .vtt, .ass), and correlates them.
 * Includes Audio-Targeted Multi-Frame Automatic Video Subtitle Analysis Engine (High Precision).
 *
 * KEY IMPROVEMENT: Instead of sampling equally-spaced timestamps (which may land on
 * scenes where nobody is talking), this engine first analyzes audio amplitude to
 * identify moments of likely speech/dialogue, then targets those timestamps for
 * visual hardsub frame analysis. This dramatically improves detection accuracy.
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

  // ============================================================
  // AUDIO ACTIVITY ANALYZER
  // Uses Web Audio API to decode small slices of the audio track
  // and find time windows with highest RMS amplitude — these are
  // the moments most likely to contain speech/dialogue.
  // Returns timestamps (seconds) sorted by activity level.
  // ============================================================
  async getAudioActivityTimestamps(file, duration) {
    const SLICE_SIZE = 1.5 * 1024 * 1024; // 1.5 MB per slice
    const NUM_WINDOWS = 20; // divide each decoded audio into 20 windows

    // Sample 4 positions across the video file (skipping intro/credits extremes)
    const sliceOffsets = [
      Math.floor(file.size * 0.12),
      Math.floor(file.size * 0.35),
      Math.floor(file.size * 0.55),
      Math.floor(file.size * 0.65),
    ];

    let audioCtx = null;
    const windowedTimestamps = []; // { time: seconds, rms: number }

    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 22050 });
    } catch (e) {
      return this._fallbackTimestamps(duration);
    }

    for (const sliceStart of sliceOffsets) {
      const actualStart = Math.max(0, Math.min(sliceStart, file.size - SLICE_SIZE));
      const actualEnd = Math.min(actualStart + SLICE_SIZE, file.size);
      if (actualEnd <= actualStart) continue;

      try {
        const blob = file.slice(actualStart, actualEnd);
        const arrayBuffer = await blob.arrayBuffer();

        let audioBuffer = null;
        try {
          audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        } catch (decodeErr) {
          // This slice may not contain decodable audio frames — skip it
          continue;
        }

        const channelData = audioBuffer.getChannelData(0);
        const bufDuration = audioBuffer.duration;
        const samplesPerWindow = Math.floor(channelData.length / NUM_WINDOWS);

        // Map file byte position proportionally to estimated video timestamp
        const filePosFraction = actualStart / file.size;
        const estimatedStartTime = filePosFraction * duration;

        for (let w = 0; w < NUM_WINDOWS; w++) {
          const windowStart = w * samplesPerWindow;
          const windowEnd = Math.min(windowStart + samplesPerWindow, channelData.length);

          // Compute RMS amplitude of this window
          let sumSq = 0;
          for (let s = windowStart; s < windowEnd; s++) {
            sumSq += channelData[s] * channelData[s];
          }
          const rms = Math.sqrt(sumSq / (windowEnd - windowStart));

          const windowFractionInBuffer = (w + 0.5) / NUM_WINDOWS;
          const estimatedTime = estimatedStartTime + windowFractionInBuffer * bufDuration;

          // Only include timestamps within the safe range (5% to 92%)
          if (estimatedTime >= duration * 0.05 && estimatedTime <= duration * 0.92) {
            windowedTimestamps.push({ time: estimatedTime, rms });
          }
        }
      } catch (err) {
        continue;
      }
    }

    try { audioCtx.close(); } catch (e) {}

    if (windowedTimestamps.length < 4) {
      return this._fallbackTimestamps(duration);
    }

    // Sort by RMS descending — loudest windows (most likely dialogue) first
    windowedTimestamps.sort((a, b) => b.rms - a.rms);

    // De-duplicate: selected timestamps must be at least 8 seconds apart
    const MIN_GAP_SECONDS = 8;
    const selected = [];
    for (const entry of windowedTimestamps) {
      const tooClose = selected.some(t => Math.abs(t - entry.time) < MIN_GAP_SECONDS);
      if (!tooClose) {
        selected.push(entry.time);
      }
      if (selected.length >= 10) break;
    }

    // Pad with fallback timestamps if we got fewer than 5 good ones
    if (selected.length < 5) {
      const fallback = this._fallbackTimestamps(duration);
      for (const t of fallback) {
        const tooClose = selected.some(s => Math.abs(s - t) < MIN_GAP_SECONDS);
        if (!tooClose) selected.push(t);
        if (selected.length >= 10) break;
      }
    }

    // Sort chronologically for efficient video seeking (avoids backward seeks)
    selected.sort((a, b) => a - b);
    return selected;
  }

  /**
   * Evenly-spaced fallback timestamps — used if audio analysis fails or is unavailable.
   * Avoids the very start (intros/logos) and very end (credits).
   */
  _fallbackTimestamps(duration) {
    return [0.12, 0.22, 0.32, 0.42, 0.52, 0.62, 0.72, 0.82].map(p => duration * p);
  }

  // ============================================================
  // HIGH-PRECISION MULTI-FRAME VIDEO SUBTITLE ANALYSIS ENGINE
  // Audio-activity-targeted: seeks to moments where someone is
  // likely talking, then detects subtitle text in the frame.
  // ============================================================
  async analyzeVideoFrameSubtitles(file) {
    return new Promise((resolve) => {
      if (!file || !file.size) {
        return resolve({ hasHardsubs: false, confidence: 0, frameDataUrl: null });
      }

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';

      const objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;

      let hasAnalyzed = false;
      let capturedDataUrl = null;
      let maxScore = -1;

      const cleanUp = (result) => {
        if (hasAnalyzed) return;
        hasAnalyzed = true;
        URL.revokeObjectURL(objectUrl);
        video.removeAttribute('src');
        video.load();
        resolve(result);
      };

      // Extended timeout: 7s to allow audio analysis + frame seeking
      const timer = setTimeout(() => {
        cleanUp({ hasHardsubs: maxScore > 0.005, confidence: 0.5, frameDataUrl: capturedDataUrl });
      }, 7000);

      video.onloadedmetadata = async () => {
        const duration = video.duration || 1000;

        // === STEP 1: Get audio-targeted timestamps (dialogue moments) ===
        let sampleTimes;
        try {
          sampleTimes = await this.getAudioActivityTimestamps(file, duration);
        } catch (e) {
          sampleTimes = this._fallbackTimestamps(duration);
        }

        // Clamp timestamps and remove duplicates
        sampleTimes = sampleTimes
          .map(t => Math.max(2, Math.min(t, duration - 3)))
          .filter((t, i, arr) => i === 0 || Math.abs(arr[i - 1] - t) > 1);

        if (sampleTimes.length === 0) {
          sampleTimes = this._fallbackTimestamps(duration);
        }

        // === STEP 2: For each timestamp, seek and analyze the frame ===
        let sampleIndex = 0;
        let detectedFrameCount = 0;

        const analyzeCurrentFrame = () => {
          try {
            const canvas = document.createElement('canvas');
            const width = video.videoWidth || 640;
            const height = video.videoHeight || 360;
            canvas.width = width;
            canvas.height = height;

            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, width, height);

            // Subtitle zone: bottom 16% of video frame (82% to 98% height)
            const subY = Math.floor(height * 0.82);
            const subH = Math.floor(height * 0.16);
            const imgData = ctx.getImageData(0, subY, width, subH);
            const pixels = imgData.data;

            let textPixelCount = 0;
            let borderedTextCount = 0;
            const totalPixels = width * subH;

            for (let i = 0; i < pixels.length - 8; i += 4) {
              const r = pixels[i];
              const g = pixels[i + 1];
              const b = pixels[i + 2];

              const isWhiteText = r > 205 && g > 205 && b > 205;
              const isYellowText = r > 195 && g > 180 && b < 135;

              if (isWhiteText || isYellowText) {
                textPixelCount++;
                const nextR = pixels[i + 4];
                const nextG = pixels[i + 5];
                const nextB = pixels[i + 6];
                if (nextR < 65 && nextG < 65 && nextB < 65) {
                  borderedTextCount++;
                }
              }
            }

            const textRatio = textPixelCount / totalPixels;
            const borderRatio = borderedTextCount / totalPixels;
            const currentScore = (borderRatio * 10) + textRatio;

            if (currentScore > maxScore || !capturedDataUrl) {
              maxScore = currentScore;
              try {
                capturedDataUrl = canvas.toDataURL('image/jpeg', 0.82);
              } catch (e) {}
            }

            if (textRatio > 0.0028 && borderRatio > 0.0006) {
              detectedFrameCount++;
            }

            sampleIndex++;
            if (sampleIndex < sampleTimes.length) {
              video.currentTime = sampleTimes[sampleIndex];
            } else {
              clearTimeout(timer);
              const isHardsub = detectedFrameCount >= 1;
              cleanUp({ hasHardsubs: isHardsub, confidence: isHardsub ? 0.95 : 0.80, frameDataUrl: capturedDataUrl });
            }
          } catch (err) {
            clearTimeout(timer);
            cleanUp({ hasHardsubs: false, confidence: 0.5, frameDataUrl: capturedDataUrl });
          }
        };

        video.onseeked = analyzeCurrentFrame;
        video.currentTime = sampleTimes[0];
      };

      video.onerror = () => {
        clearTimeout(timer);
        cleanUp({ hasHardsubs: false, confidence: 0.5, frameDataUrl: null });
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

      // Audio-targeted visual hardsub analysis
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
