/**
 * Folder Scanner & Batch Queue Manager
 * Traverses file trees (Drag & Drop, WebKitDirectory, File System Access API)
 * Filters video files and feeds them to the processing pipeline with live updates.
 */
class MediaScanner {
  constructor() {
    this.videoExtensions = new Set(['mkv', 'mp4', 'm4v', 'avi', 'webm', 'ts', 'mov']);
  }

  /**
   * Check if file is a supported video format
   */
  isVideoFile(file) {
    if (!file || !file.name) return false;
    const ext = file.name.split('.').pop().toLowerCase();
    return this.videoExtensions.has(ext);
  }

  /**
   * Process FileList from HTML file input
   */
  processFileList(fileList) {
    const files = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      if (this.isVideoFile(file)) {
        files.push(file);
      }
    }
    return files;
  }

  /**
   * Process Drag & Drop DataTransfer items recursively
   */
  async processDataTransferItems(items) {
    const files = [];
    const entries = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry) {
          entries.push(entry);
        } else {
          const file = item.getAsFile();
          if (file && this.isVideoFile(file)) {
            files.push(file);
          }
        }
      }
    }

    for (const entry of entries) {
      const entryFiles = await this.readFileSystemEntry(entry);
      files.push(...entryFiles);
    }

    return files;
  }

  /**
   * Recursively read WebKitFileSystemEntry (DirectoryEntry / FileEntry)
   */
  async readFileSystemEntry(entry, pathPrefix = '') {
    const files = [];

    if (entry.isFile) {
      return new Promise((resolve) => {
        entry.file((file) => {
          if (this.isVideoFile(file)) {
            // Attach relative path property
            file.relativePath = pathPrefix ? `${pathPrefix}/${file.name}` : file.name;
            files.push(file);
          }
          resolve(files);
        }, () => resolve([]));
      });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const readEntries = () => {
        return new Promise((resolve) => {
          dirReader.readEntries(async (subEntries) => {
            if (subEntries.length === 0) {
              resolve(files);
            } else {
              const currentPath = pathPrefix ? `${pathPrefix}/${entry.name}` : entry.name;
              for (const subEntry of subEntries) {
                const subFiles = await this.readFileSystemEntry(subEntry, currentPath);
                files.push(...subFiles);
              }
              // Read remaining entries if batching occurs
              const moreFiles = await readEntries();
              files.push(...moreFiles);
              resolve(files);
            }
          }, () => resolve([]));
        });
      };
      return await readEntries();
    }
    return files;
  }

  /**
   * Modern Directory Picker via showDirectoryPicker API
   */
  async pickDirectory() {
    if (typeof window.showDirectoryPicker !== 'function') {
      return null;
    }
    try {
      const dirHandle = await window.showDirectoryPicker();
      const files = [];
      await this.traverseDirectoryHandle(dirHandle, dirHandle.name, files);
      return files;
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('Directory picker error:', err);
      }
      return null;
    }
  }

  /**
   * Helper to recursively scan FileSystemDirectoryHandle
   */
  async traverseDirectoryHandle(dirHandle, currentPath, files) {
    for await (const entry of dirHandle.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        if (this.isVideoFile(file)) {
          file.relativePath = `${currentPath}/${file.name}`;
          files.push(file);
        }
      } else if (entry.kind === 'directory') {
        await this.traverseDirectoryHandle(entry, `${currentPath}/${entry.name}`, files);
      }
    }
  }

  /**
   * Execute batch scan with live progress updates
   */
  async scanBatch(files, onProgress, onFileComplete) {
    const results = [];
    const total = files.length;

    for (let i = 0; i < total; i++) {
      const file = files[i];
      const percent = Math.round(((i + 1) / total) * 100);
      
      if (onProgress) {
        onProgress({
          currentIndex: i + 1,
          totalFiles: total,
          percent: percent,
          currentFileName: file.name
        });
      }

      // Analyze using MediaInfo WASM / Fast Parser
      const analysis = await window.mediaInfoEngine.analyzeFile(file);

      const mediaRecord = {
        id: `media_${Date.now()}_${i}`,
        file: file,
        fileName: file.name,
        filePath: file.webkitRelativePath || file.relativePath || file.name,
        fileSize: file.size,
        fileSizeFormatted: this.formatBytes(file.size),
        analysis: analysis
      };

      results.push(mediaRecord);

      if (onFileComplete) {
        onFileComplete(mediaRecord);
      }
    }

    return results;
  }

  /**
   * Format bytes to human readable size (MB, GB)
   */
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
