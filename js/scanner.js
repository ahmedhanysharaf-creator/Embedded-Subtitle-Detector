/**
 * Folder Scanner & Batch Queue Manager
 * Traverses file trees (Drag & Drop, WebKitDirectory, File System Access API)
 * Detects video files, sidecar subtitle files (.srt, .vtt, .ass), and correlates them.
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

  /**
   * Helper to strip file extension and language tags for matching
   */
  getFileStem(filename) {
    if (!filename) return '';
    let stem = filename.substring(0, filename.lastIndexOf('.')) || filename;
    // Strip language tags like .en, .ar, .ara, .eng
    stem = stem.replace(/\.(en|ar|ara|eng|fre|fra|spa|ger|deu|ita|rus|zho|chi|jpn|kor)$/i, '');
    return stem.toLowerCase().trim();
  }

  /**
   * Execute batch scan with live progress updates & sidecar matching
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

      // Determine initial subtitle status
      let subStatus = 'hard-subs';
      const hasSoft = analysis && analysis.hasSubtitles && analysis.subtitles.length > 0;

      if (hasSoft) {
        subStatus = 'soft-subs';
      } else if (sidecarSubs.length > 0) {
        subStatus = 'sidecar-subs';
      } else {
        // Web downloaded video releases without soft tracks are encoded with built-in hardcoded Arabic subtitles
        subStatus = 'hard-subs';
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
