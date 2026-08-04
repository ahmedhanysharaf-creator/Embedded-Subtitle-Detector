/**
 * Folder Scanner & Batch Queue Manager
 * Traverses file trees (Drag & Drop, WebKitDirectory, File System Access API)
 * Detects video files, sidecar subtitle files (.srt, .vtt, .ass), and correlates them.
 *
 * HARDSUB DETECTION ENGINE v3 — CONTINUOUS PLAYBACK + AUDIO GATING
 *
 * Architecture: One video element plays at 4x speed through 4 segments.
 * `ontimeupdate` fires every ~250ms real time (~1 video-second at 4x).
 * At each event, audio amplitude is measured via AnalyserNode. If the
 * amplitude is above a speech threshold, the frame is captured and
 * analyzed for subtitle text. This guarantees we only inspect frames
 * where someone is actually talking — dramatically improving accuracy.
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
        if (entry) entries.push(entry);
        else {
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
      const readEntries = () => new Promise((resolve) => {
        dirReader.readEntries(async (subEntries) => {
          if (subEntries.length === 0) return resolve({ videoFiles, subtitleFiles });
          const currentPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
          for (const subEntry of subEntries) {
            const r = await this.readFileSystemEntry(subEntry, currentPath);
            videoFiles.push(...r.videoFiles);
            subtitleFiles.push(...r.subtitleFiles);
          }
          const more = await readEntries();
          videoFiles.push(...more.videoFiles);
          subtitleFiles.push(...more.subtitleFiles);
          resolve({ videoFiles, subtitleFiles });
        }, () => resolve({ videoFiles, subtitleFiles }));
      });
      return await readEntries();
    }
    return { videoFiles, subtitleFiles };
  }

  async pickDirectory() {
    if (typeof window.showDirectoryPicker !== 'function') return null;
    try {
      const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      this.rootDirectoryHandle = dirHandle;
      const videoFiles = [], subtitleFiles = [];
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
  // PIXEL ANALYZER — called per-frame during playback
  // Checks the subtitle zone (bottom 19% of frame) for bright text
  // pixels adjacent to dark pixels (hardsub characteristic).
  // Returns a score object { textRatio, borderRatio, shadowRatio, score }
  // ================================================================
  _analyzeFramePixels(video) {
    try {
      const canvas = document.createElement('canvas');
      const w = video.videoWidth || 640;
      const h = video.videoHeight || 360;
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, w, h);

      // Check if canvas is entirely black (codec not supported / security error)
      const probe = ctx.getImageData(Math.floor(w / 2), Math.floor(h / 2), 1, 1).data;
      const frameIsEmpty = probe[0] === 0 && probe[1] === 0 && probe[2] === 0;

      // Subtitle zone: bottom 19% of frame (from 79% to 98% height)
      const subY = Math.floor(h * 0.79);
      const subH = Math.floor(h * 0.19);
      const imgData = ctx.getImageData(0, subY, w, subH);
      const px = imgData.data;
      const totalPx = w * subH;

      let textCount = 0, borderCount = 0, shadowCount = 0;

      for (let i = 0; i < px.length - 8; i += 4) {
        const r = px[i], g = px[i + 1], b = px[i + 2];

        // Common hardsub text colors (white, yellow, cyan)
        const isWhite  = r > 195 && g > 195 && b > 195;
        const isYellow = r > 185 && g > 170 && b < 150;
        const isCyan   = r < 120 && g > 188 && b > 188;

        if (isWhite || isYellow || isCyan) {
          textCount++;
          const nr = px[i + 4], ng = px[i + 5], nb = px[i + 6];
          if      (nr < 80  && ng < 80  && nb < 80 ) borderCount++; // hard outline
          else if (nr < 150 && ng < 150 && nb < 150) shadowCount++; // soft shadow
        }
      }

      const textRatio   = textCount  / totalPx;
      const borderRatio = borderCount / totalPx;
      const shadowRatio = shadowCount / totalPx;
      const score = (borderRatio * 10) + (shadowRatio * 3) + textRatio;

      return { textRatio, borderRatio, shadowRatio, score, frameIsEmpty, canvas };
    } catch (e) {
      return { textRatio: 0, borderRatio: 0, shadowRatio: 0, score: 0, frameIsEmpty: true, canvas: null };
    }
  }

  // ================================================================
  // MAIN HARDSUB ANALYSIS ENGINE — Continuous Playback + Audio Gating
  //
  // Plays the video at 4x speed through 4 segments. On each
  // ontimeupdate, measures audio amplitude and (if loud enough)
  // analyzes the frame for subtitle text. Both audio and visual
  // analysis happen in the SAME continuous playback pass.
  // ================================================================
  async analyzeVideoFrameSubtitles(file) {
    return new Promise((resolve) => {
      if (!file || !file.size) {
        return resolve({ hasHardsubs: false, confidence: 0, frameDataUrl: null });
      }

      const objectUrl = URL.createObjectURL(file);
      let settled = false;
      let capturedDataUrl = null;
      let maxScore = -1;
      let detectedCount = 0;
      let totalFramesAnalyzed = 0;

      const done = (hasHardsubs) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(objectUrl);
        resolve({
          hasHardsubs,
          confidence: hasHardsubs ? 0.92 : (totalFramesAnalyzed > 5 ? 0.80 : 0.50),
          frameDataUrl: capturedDataUrl
        });
      };

      // 15 second hard cap
      const masterTimer = setTimeout(() => {
        done(detectedCount >= 1 || maxScore > 0.015);
      }, 15000);

      const video = document.createElement('video');
      video.playsInline = true;
      video.preload = 'auto';
      // NOT muted — required so AudioContext can read audio
      video.src = objectUrl;

      // ---- AudioContext setup ----
      // GainNode at 0 = audio processed but silent (no speaker output)
      let analyser = null;
      let freqData = null;
      let audioGatingEnabled = false;
      let audioCtx = null;

      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256; // 128 frequency bins
        const gain = audioCtx.createGain();
        gain.gain.value = 0; // silent
        const source = audioCtx.createMediaElementSource(video);
        source.connect(analyser);
        analyser.connect(gain);
        gain.connect(audioCtx.destination);
        freqData = new Uint8Array(analyser.frequencyBinCount);
        audioGatingEnabled = true;
      } catch (e) {
        // AudioContext unavailable — will analyze all frames without audio gating
        // Must mute the video so play() works under autoplay policy
        video.muted = true;
        audioGatingEnabled = false;
      }

      // Speech detection threshold:
      // frequencyBinCount=128 with sampleRate ~44100Hz: bin i ≈ i × 344 Hz
      // We care about bins 1–12 ≈ 344Hz to ~4kHz (core speech range)
      const SPEECH_BIN_START = 1;
      const SPEECH_BIN_END   = 12;
      const SPEECH_THRESHOLD = 18; // 0–255 scale; 18 is a quiet-but-present voice

      // Segments: fraction of total duration at which we start each burst
      // Spread across the movie body (skip intro/credits)
      const SEGMENT_STARTS  = [0.14, 0.36, 0.58, 0.78];
      const MAX_FRAMES_PER_SEGMENT = 18; // max timeupdate events per segment
      const PLAYBACK_RATE = 4; // 4x = 1 real-second covers 4 video-seconds

      let duration = 600;
      let segIdx = 0;
      let segFrameCount = 0;
      let emptyFrameCount = 0;

      const cleanup = () => {
        if (audioCtx) try { audioCtx.close(); } catch (e) {}
        video.ontimeupdate = null;
        video.onseeked = null;
        video.pause();
        video.removeAttribute('src');
        video.load();
      };

      const finish = (hasHardsubs) => {
        cleanup();
        clearTimeout(masterTimer);
        done(hasHardsubs);
      };

      const goToNextSegment = () => {
        video.pause();
        segIdx++;
        if (segIdx >= SEGMENT_STARTS.length) {
          finish(detectedCount >= 1);
          return;
        }
        segFrameCount = 0;
        emptyFrameCount = 0;
        video.currentTime = duration * SEGMENT_STARTS[segIdx];
      };

      video.onseeked = () => {
        if (settled) return;
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }
        video.playbackRate = PLAYBACK_RATE;
        video.play().catch(() => {
          // play() rejected — try muted (sacrifices audio gating for this segment)
          audioGatingEnabled = false;
          video.muted = true;
          video.play().catch(() => goToNextSegment());
        });
      };

      video.ontimeupdate = () => {
        if (settled || video.paused || video.ended) return;

        segFrameCount++;

        // Too many empty frames = probably a black scene, skip segment
        if (emptyFrameCount > 5 && segFrameCount > 8) {
          goToNextSegment();
          return;
        }

        // Hit segment frame cap — move to next segment
        if (segFrameCount > MAX_FRAMES_PER_SEGMENT) {
          goToNextSegment();
          return;
        }

        // ---- AUDIO GATE ----
        // If AudioContext is working, only analyze frames where speech is detected
        if (audioGatingEnabled && analyser && freqData) {
          analyser.getByteFrequencyData(freqData);
          let speechSum = 0;
          for (let i = SPEECH_BIN_START; i <= SPEECH_BIN_END; i++) {
            speechSum += freqData[i];
          }
          const speechLevel = speechSum / (SPEECH_BIN_END - SPEECH_BIN_START + 1);
          if (speechLevel < SPEECH_THRESHOLD) {
            return; // quiet frame — skip visual analysis
          }
        }

        // ---- VISUAL FRAME ANALYSIS ----
        const result = this._analyzeFramePixels(video);

        if (result.frameIsEmpty) {
          emptyFrameCount++;
          return;
        }

        totalFramesAnalyzed++;

        // Save the frame with the highest subtitle score for thumbnail
        if (result.score > maxScore || !capturedDataUrl) {
          maxScore = result.score;
          if (result.canvas) {
            try { capturedDataUrl = result.canvas.toDataURL('image/jpeg', 0.82); } catch (e) {}
          }
        }

        // DETECTION: bright text + dark contrast edge in subtitle zone
        const isPositive = result.textRatio > 0.0018
          && (result.borderRatio > 0.0003 || result.shadowRatio > 0.0008);

        if (isPositive) {
          detectedCount++;
          // Early exit: 2 positive detections = high confidence
          if (detectedCount >= 2) {
            finish(true);
          }
        }
      };

      video.onerror = () => {
        clearTimeout(masterTimer);
        cleanup();
        done(false);
      };

      video.onloadedmetadata = () => {
        duration = video.duration || 600;
        segFrameCount = 0;
        emptyFrameCount = 0;
        video.currentTime = duration * SEGMENT_STARTS[0];
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
          percent,
          currentFileName: file.name
        });
      }

      const analysis = await window.mediaInfoEngine.analyzeFile(file);
      const stem = this.getFileStem(file.name);
      const sidecarSubs = sidecarMap.get(stem) || [];

      // Audio-gated continuous playback hardsub analysis
      const visualRes = await this.analyzeVideoFrameSubtitles(file);
      const subStatus = visualRes.hasHardsubs ? 'has-subs' : 'no-subs';

      const mediaRecord = {
        id: `media_${Date.now()}_${i}`,
        file,
        fileName: file.name,
        filePath: file.webkitRelativePath || file.relativePath || file.name,
        fileSize: file.size,
        fileSizeFormatted: this.formatBytes(file.size),
        analysis,
        subStatus,
        sidecarSubs,
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
