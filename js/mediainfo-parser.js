/**
 * MediaInfo.js WebAssembly Integration with Chunked Stream Reader
 * Gold-standard accurate metadata parser for MKV, MP4, AVI, WebM, TS, MOV
 */
class MediaInfoEngine {
  constructor() {
    this.mediainfoInstance = null;
    this.isInitializing = false;
    this.initPromise = null;
  }

  /**
   * Initialize MediaInfo WASM instance
   */
  async init() {
    if (this.mediainfoInstance) return this.mediainfoInstance;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      if (typeof window.MediaInfo === 'undefined') {
        console.warn('MediaInfo library script not loaded on window object');
        resolve(null);
        return;
      }

      window.MediaInfo({ format: 'object' }, (mediainfo) => {
        this.mediainfoInstance = mediainfo;
        console.log('✅ MediaInfo WASM engine initialized successfully');
        resolve(mediainfo);
      }, (err) => {
        console.warn('⚠️ MediaInfo WASM init error:', err);
        resolve(null);
      });
    });

    return this.initPromise;
  }

  /**
   * Analyze media file chunk-by-chunk using MediaInfo WASM
   */
  async analyzeFile(file) {
    // Attempt Fast Native Header Parser first for instant preliminary verification
    const fastResult = await FastHeaderParser.parseFile(file);

    // Initialize WASM instance
    const mediainfo = await this.init();

    if (!mediainfo) {
      console.warn('Using FastHeaderParser fallback (WASM unavailable)');
      return fastResult || this.fallbackUnknown(file);
    }

    try {
      const getSize = () => file.size;
      const readChunk = (chunkSize, offset) => {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            if (e.target.error) {
              reject(e.target.error);
            } else {
              resolve(new Uint8Array(e.target.result));
            }
          };
          reader.onerror = (e) => reject(e);
          const blob = file.slice(offset, Math.min(offset + chunkSize, file.size));
          reader.readAsArrayBuffer(blob);
        });
      };

      const miResult = await mediainfo.analyzeData(getSize, readChunk);
      return this.parseMediaInfoOutput(file, miResult, fastResult);
    } catch (err) {
      console.warn(`MediaInfo analysis failed for ${file.name}:`, err);
      return fastResult || this.fallbackUnknown(file);
    }
  }

  /**
   * Parse MediaInfo JSON output into normalized subtitle structure
   */
  parseMediaInfoOutput(file, miData, fastResult) {
    if (!miData || !miData.media || !miData.media.track) {
      return fastResult || this.fallbackUnknown(file);
    }

    const tracks = miData.media.track;
    const generalTrack = tracks.find(t => t['@type'] === 'General') || {};
    const textTracks = tracks.filter(t => t['@type'] === 'Text');
    const videoTracks = tracks.filter(t => t['@type'] === 'Video');
    const audioTracks = tracks.filter(t => t['@type'] === 'Audio');

    const subtitles = textTracks.map((tr, idx) => {
      const rawFormat = tr.Format || tr.CodecID || 'SRT';
      let formatDisplay = rawFormat;
      if (rawFormat.includes('UTF-8') || rawFormat.includes('SubRip')) formatDisplay = 'SubRip (SRT)';
      else if (rawFormat.includes('ASS') || rawFormat.includes('SSA')) formatDisplay = 'ASS / SSA';
      else if (rawFormat.includes('PGS') || rawFormat.includes('HDMV')) formatDisplay = 'PGS (HDMV)';
      else if (rawFormat.includes('VobSub')) formatDisplay = 'VobSub';
      else if (rawFormat.includes('tx3g') || rawFormat.includes('Timed Text')) formatDisplay = 'MOV_TEXT (tx3g)';

      // Language detection
      const lang = tr.Language || tr['Language/String'] || tr.Language_String || tr.Language_String1 || 'und';
      const langCode = tr.Language_String2 || lang.slice(0, 3).toLowerCase();

      return {
        trackId: idx + 1,
        format: formatDisplay,
        rawFormat: rawFormat,
        language: lang,
        langCode: langCode,
        title: tr.Title || tr.Header || `Track #${idx + 1}`,
        isDefault: (tr.Default === 'Yes' || tr.Default === '1'),
        isForced: (tr.Forced === 'Yes' || tr.Forced === '1')
      };
    });

    const videoFormat = videoTracks[0] ? (videoTracks[0].Format || videoTracks[0].CodecID) : 'Unknown';
    const resolution = videoTracks[0] && videoTracks[0].Width ? `${videoTracks[0].Width}x${videoTracks[0].Height}` : '';

    return {
      container: generalTrack.Format || file.name.split('.').pop().toUpperCase(),
      hasSubtitles: subtitles.length > 0,
      subtitlesCount: subtitles.length,
      subtitles: subtitles,
      videoCodec: videoFormat,
      resolution: resolution,
      audioTracksCount: audioTracks.length,
      duration: generalTrack.Duration || null,
      parsedBy: 'MediaInfo WASM Engine'
    };
  }

  fallbackUnknown(file) {
    return {
      container: file.name.split('.').pop().toUpperCase(),
      hasSubtitles: false,
      subtitlesCount: 0,
      subtitles: [],
      videoCodec: 'Unknown',
      parsedBy: 'Basic Fallback'
    };
  }
}

// Global Singleton Instance
window.mediaInfoEngine = new MediaInfoEngine();
