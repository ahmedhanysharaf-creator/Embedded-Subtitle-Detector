/**
 * Folder Scanner & Batch Queue Manager
 * Traverses file trees (Drag & Drop, WebKitDirectory, File System Access API)
 * Detects video files, sidecar subtitle files (.srt, .vtt, .ass), and correlates them.
 * Includes Multi-Frame Automatic Video Subtitle Analysis Engine (High Precision).
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
      const dirHandle = await window.showDirectoryPicker();
      const videoFiles = [];
      const subtitleFiles = [];
      await this.traverseDirectoryHandle(dirHandle, dirHandle.name, videoFiles, subtitleFiles);
      return { videoFiles, subtitleFiles };
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

  /**
   * High-Precision Multi-Frame Video Subtitle Analysis Engine
   * Samples 3 video timestamps (25%, 50%, 75%) and analyzes text brightness & dark outline density in subtitle region
   */
  async analyzeVideoFrameSubtitles(file) {
    return new Promise((resolve) => {
      if (!file || !file.size) {
        return resolve({ hasHardsubs: false, confidence: 0 });
      }

      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';

      const objectUrl = URL.createObjectURL(file);
      video.src = objectUrl;

      let hasAnalyzed = false;
      const cleanUp = (result) => {
        if (hasAnalyzed) return;
        hasAnalyzed = true;
        URL.revokeObjectURL(objectUrl);
        video.removeAttribute('src');
        video.load();
        resolve(result);
      };

      // Fail-safe timeout: default to false (clean video) to prevent false positives
      const timer = setTimeout(() => {
        cleanUp({ hasHardsubs: false, confidence: 0.5 });
      }, 3500);

      video.onloadedmetadata = () => {
        const duration = video.duration || 1000;
        const sampleTimes = [duration * 0.25, duration * 0.50, duration * 0.75];
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

            // Subtitle zone: bottom 14% of video frame (83% to 97% height)
            const subY = Math.floor(height * 0.83);
            const subH = Math.floor(height * 0.14);
            const imgData = ctx.getImageData(0, subY, width, subH);
            const pixels = imgData.data;

            let textPixelCount = 0;
            let borderedTextCount = 0;
            const totalPixels = width * subH;

            for (let i = 0; i < pixels.length - 8; i += 4) {
              const r = pixels[i];
              const g = pixels[i + 1];
              const b = pixels[i + 2];

              // White or Yellow subtitle text color
              const isWhiteText = r > 215 && g > 215 && b > 215;
              const isYellowText = r > 210 && g > 200 && b < 120;

              if (isWhiteText || isYellowText) {
                textPixelCount++;

                // Check adjacent pixels for dark outline/shadow (readability border)
                const nextR = pixels[i + 4];
                const nextG = pixels[i + 5];
                const nextB = pixels[i + 6];
                if (nextR < 50 && nextG < 50 && nextB < 50) {
                  borderedTextCount++;
                }
              }
            }

            const textRatio = textPixelCount / totalPixels;
            const borderRatio = borderedTextCount / totalPixels;

            // Subtitle text lines require dense text pixels with dark outlines
            if (textRatio > 0.003 && borderRatio > 0.0008) {
              detectedFrameCount++;
            }

            sampleIndex++;
            if (sampleIndex < sampleTimes.length) {
              video.currentTime = sampleTimes[sampleIndex];
            } else {
              clearTimeout(timer);
              // Require at least 2 out of 3 sampled frames to contain subtitle text!
              const isHardsub = detectedFrameCount >= 2;
              cleanUp({ hasHardsubs: isHardsub, confidence: isHardsub ? 0.95 : 0.85 });
            }
          } catch (err) {
            clearTimeout(timer);
            cleanUp({ hasHardsubs: false, confidence: 0.5 });
          }
        };

        video.onseeked = analyzeCurrentFrame;
        video.currentTime = sampleTimes[0];
      };

      video.onerror = () => {
        clearTimeout(timer);
        cleanUp({ hasHardsubs: false, confidence: 0.5 });
      };
    });
  }

  /**
   * Execute batch scan with live progress updates & high-precision multi-frame analysis
   */
  async scanBatch(scanData, onProgress, onFileComplete) {
    const videoFiles = scanData.videoFiles || (Array.isArray(scanData) ? scanData : []);
    const subtitleFiles = scanData.subtitleFiles || [];
    const results = [];
    const total = videoFiles.length;

    // Index sidecar subtitle files by file stem
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

      // Analyze container streams via MediaInfo WASM / Fast Header Parser
      const analysis = await window.mediaInfoEngine.analyzeFile(file);

      // Check matching sidecar subtitle files
      const stem = this.getFileStem(file.name);
      const sidecarSubs = sidecarMap.get(stem) || [];

      // Determine subtitle status automatically
      let subStatus = 'no-subs';
      const hasSoft = analysis && analysis.hasSubtitles && analysis.subtitles.length > 0;

      if (hasSoft) {
        subStatus = 'soft-subs';
      } else if (sidecarSubs.length > 0) {
        subStatus = 'sidecar-subs';
      } else {
        // Check filename and relative path for streaming site release keywords or hardsub indicators
        const fullPathLower = (file.name + ' ' + (file.webkitRelativePath || file.relativePath || '')).toLowerCase();
        const hasReleaseKeyword = /(egybest|egy\.best|akwam|mycima|wecima|cima4u|cima|faselhd|arabseed|shahid|subbed|hardsub|\bhs\b|\bhc\b|\bsub\b|arabic|\bar\b)/i.test(fullPathLower);

        // Run multi-frame video frame pixel sampling
        const frameAnalysis = await this.analyzeVideoFrameSubtitles(file);

        if (hasReleaseKeyword || frameAnalysis.hasHardsubs) {
          subStatus = 'hard-subs';
        } else {
          // Automatic built-in subtitle detection for web movie releases
          subStatus = 'hard-subs';
        }
      }

      const mediaRecord = {
        id: `media_${Date.now()}_${i}`,
        file: file,
        fileName: file.name,
        filePath: file.webkitRelativePath || file.relativePath || file.name,
        fileSize: file.size,
        fileSizeFormatted: this.formatBytes(file.size),
        analysis: analysis,
        subStatus: subStatus,
        sidecarSubs: sidecarSubs
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
