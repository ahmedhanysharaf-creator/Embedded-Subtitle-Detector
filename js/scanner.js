/**
 * Folder Scanner & Batch Queue Manager
 * Traverses file trees (Drag & Drop, WebKitDirectory, File System Access API)
 * Detects video files, sidecar subtitle files (.srt, .vtt, .ass), and correlates them.
 *
 * HARDSUB DETECTION ENGINE v4 — HIGH-PRECISION DUAL-EDGE STROKE + ROW HISTOGRAM ANALYSIS
 *
 * Eliminates false positives from white scene objects (shirts, walls, lights, snow, reflections):
 * 1. Dual-Edge Outline Requirement: Text pixels must be bounded by dark outline/shadow pixels
 *    (<85 RGB) on BOTH left and right sides within 1-5px (characteristic of thin letter strokes).
 * 2. Row Histogram Analysis: Subtitles form sharp horizontal line bands (15-25px height).
 *    Measures peak density in moving vertical row windows.
 * 3. Strict Color Bounds: Pure White (R,G,B>200, saturation<35) and Subtitle Yellow (R>200, G>185, B<125).
 * 4. Multi-Source Subtitle Classification: Correctly integrates container softsubs, sidecar files,
 *    and visual hardsubs into overall subStatus.
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
  // HIGH-PRECISION FRAME PIXEL ANALYZER
  // Uses dual-edge outline stroke matching & row histogram density.
  // Rejects large bright objects (shirts, walls, reflections, snow).
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

      // Probe center pixel to verify frame is decodable
      const probe = ctx.getImageData(Math.floor(w / 2), Math.floor(h / 2), 1, 1).data;
      const frameIsEmpty = (probe[0] === 0 && probe[1] === 0 && probe[2] === 0);

      // Subtitle Zone: Lower 18% of frame, horizontally bounded (10% to 90% width)
      const subX = Math.floor(w * 0.10);
      const subW = Math.floor(w * 0.80);
      const subY = Math.floor(h * 0.78);
      const subH = Math.floor(h * 0.18);

      const imgData = ctx.getImageData(subX, subY, subW, subH);
      const px = imgData.data;
      const totalPx = subW * subH;

      const rowCounts = new Int32Array(subH);
      let textStrokePixels = 0;
      let dualEdgeOutlineCount = 0;

      for (let y = 0; y < subH; y++) {
        const rowOffset = y * subW * 4;
        for (let x = 5; x < subW - 5; x++) {
          const idx = rowOffset + x * 4;
          const r = px[idx], g = px[idx + 1], b = px[idx + 2];

          // 1. High-brightness White: R,G,B > 200 with low color variance (saturation < 35)
          const maxRGB = Math.max(r, g, b);
          const minRGB = Math.min(r, g, b);
          const isWhiteText = minRGB > 200 && (maxRGB - minRGB) < 35;

          // 2. Subtitle Yellow: R > 200, G > 185, B < 125, R > B + 75
          const isYellowText = r > 200 && g > 185 && b < 125 && (r - b) > 75;

          if (isWhiteText || isYellowText) {
            textStrokePixels++;

            // DUAL-EDGE OUTLINE CHECK: Must have dark pixel (<85 RGB) within 1-5px LEFT AND RIGHT
            let leftDark = false;
            for (let dx = 1; dx <= 5; dx++) {
              const lIdx = rowOffset + (x - dx) * 4;
              if (px[lIdx] < 85 && px[lIdx + 1] < 85 && px[lIdx + 2] < 85) {
                leftDark = true;
                break;
              }
            }

            let rightDark = false;
            for (let dx = 1; dx <= 5; dx++) {
              const rIdx = rowOffset + (x + dx) * 4;
              if (px[rIdx] < 85 && px[rIdx + 1] < 85 && px[rIdx + 2] < 85) {
                rightDark = true;
                break;
              }
            }

            if (leftDark && rightDark) {
              dualEdgeOutlineCount++;
              rowCounts[y]++;
            }
          }
        }
      }

      // ROW HISTOGRAM PEAK ANALYSIS: Subtitles form horizontal row lines (~15-25px height)
      let maxRowWindowSum = 0;
      const windowSize = Math.min(25, subH);
      let currentWindowSum = 0;

      for (let y = 0; y < windowSize; y++) currentWindowSum += rowCounts[y];
      maxRowWindowSum = currentWindowSum;

      for (let y = windowSize; y < subH; y++) {
        currentWindowSum += rowCounts[y] - rowCounts[y - windowSize];
        if (currentWindowSum > maxRowWindowSum) maxRowWindowSum = currentWindowSum;
      }

      const strokeRatio = dualEdgeOutlineCount / totalPx;
      const windowDensityRatio = maxRowWindowSum / (subW * windowSize);

      const score = (windowDensityRatio * 25) + (strokeRatio * 15);

      // HIGH-CONFIDENCE SUBTITLE FRAME TEST:
      // Real subtitle frames require:
      // - At least 0.08% of subtitle box pixels are dual-edge bounded letter strokes
      // - Peak row window density > 0.6%
      // - Total dual-edge count > 50 stroke pixels
      const isSubFrame = strokeRatio > 0.0008
        && windowDensityRatio > 0.006
        && dualEdgeOutlineCount > 50;

      return { isSubFrame, strokeRatio, windowDensityRatio, score, frameIsEmpty, canvas };
    } catch (e) {
      return { isSubFrame: false, strokeRatio: 0, windowDensityRatio: 0, score: 0, frameIsEmpty: true, canvas: null };
    }
  }

  // ================================================================
  // MAIN HARDSUB ANALYSIS ENGINE — Continuous Playback + Speech Gating
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
          confidence: hasHardsubs ? 0.95 : (totalFramesAnalyzed > 8 ? 0.85 : 0.50),
          frameDataUrl: capturedDataUrl
        });
      };

      // 15 second max hard cap
      const masterTimer = setTimeout(() => {
        done(detectedCount >= 2 || maxScore > 0.08);
      }, 15000);

      const video = document.createElement('video');
      video.playsInline = true;
      video.preload = 'auto';
      video.src = objectUrl;

      let analyser = null;
      let freqData = null;
      let audioGatingEnabled = false;
      let audioCtx = null;

      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        const gain = audioCtx.createGain();
        gain.gain.value = 0; // silent
        const source = audioCtx.createMediaElementSource(video);
        source.connect(analyser);
        analyser.connect(gain);
        gain.connect(audioCtx.destination);
        freqData = new Uint8Array(analyser.frequencyBinCount);
        audioGatingEnabled = true;
      } catch (e) {
        video.muted = true;
        audioGatingEnabled = false;
      }

      const SPEECH_BIN_START = 1;
      const SPEECH_BIN_END   = 12;
      const SPEECH_THRESHOLD = 20;

      const SEGMENT_STARTS = [0.14, 0.36, 0.58, 0.78];
      const MAX_FRAMES_PER_SEGMENT = 18;
      const PLAYBACK_RATE = 4;

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
          finish(detectedCount >= 2 || maxScore > 0.08);
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
          audioGatingEnabled = false;
          video.muted = true;
          video.play().catch(() => goToNextSegment());
        });
      };

      video.ontimeupdate = () => {
        if (settled || video.paused || video.ended) return;

        segFrameCount++;

        if (emptyFrameCount > 5 && segFrameCount > 8) {
          goToNextSegment();
          return;
        }

        if (segFrameCount > MAX_FRAMES_PER_SEGMENT) {
          goToNextSegment();
          return;
        }

        // AUDIO GATE: Only evaluate frames when speech audio amplitude is detected
        if (audioGatingEnabled && analyser && freqData) {
          analyser.getByteFrequencyData(freqData);
          let speechSum = 0;
          for (let i = SPEECH_BIN_START; i <= SPEECH_BIN_END; i++) {
            speechSum += freqData[i];
          }
          const speechLevel = speechSum / (SPEECH_BIN_END - SPEECH_BIN_START + 1);
          if (speechLevel < SPEECH_THRESHOLD) return;
        }

        // VISUAL FRAME ANALYSIS
        const result = this._analyzeFramePixels(video);

        if (result.frameIsEmpty) {
          emptyFrameCount++;
          return;
        }

        totalFramesAnalyzed++;

        if (result.score > maxScore || !capturedDataUrl) {
          maxScore = result.score;
          if (result.canvas) {
            try { capturedDataUrl = result.canvas.toDataURL('image/jpeg', 0.82); } catch (e) {}
          }
        }

        if (result.isSubFrame) {
          detectedCount++;
          // Require at least 2 distinct positive frames across playback to confirm hardsubs
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
   * Execute batch scan with live progress updates & high-precision multi-source analysis
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

      // 1. Container Softsub Metadata Parsing (MKV/MP4 headers via WASM / Native Parser)
      const analysis = await window.mediaInfoEngine.analyzeFile(file);

      // 2. Matching Sidecar Subtitle Files (.srt, .vtt, .ass in folder)
      const stem = this.getFileStem(file.name);
      const sidecarSubs = sidecarMap.get(stem) || [];

      const allSubs = (analysis && analysis.subtitles) ? analysis.subtitles : [];
      const fullSoftTracks = allSubs.filter(s => !s.isForced && !/(forced|foreign|partial|narrative)/i.test(s.title || ''));
      const hasFullSoft = fullSoftTracks.length > 0 || (analysis && analysis.hasSubtitles);

      // 3. High-Precision Visual Hardsub Detection (Burned-in subtitles in frame image)
      const visualRes = await this.analyzeVideoFrameSubtitles(file);

      // OVERALL SUBTITLE STATUS: Present if ANY source has subtitles
      const hasAnySubtitles = hasFullSoft || sidecarSubs.length > 0 || visualRes.hasHardsubs;
      const subStatus = hasAnySubtitles ? 'has-subs' : 'no-subs';

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
        hasHardsubs: visualRes.hasHardsubs,
        hasSoftsubs: hasFullSoft,
        hasSidecar: sidecarSubs.length > 0
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
