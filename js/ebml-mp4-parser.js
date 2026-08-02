/**
 * Fast Native JS Container Header Parser for MKV (EBML) & MP4 (ISO-BMFF)
 * Allows ultra-fast client-side detection of embedded subtitle streams
 */
class FastHeaderParser {
  
  /**
   * Helper to read a slice of a File into an ArrayBuffer
   */
  static readFileSlice(file, start = 0, length = 256 * 1024) {
    return new Promise((resolve, reject) => {
      const blob = file.slice(start, Math.min(start + length, file.size));
      const reader = new FileReader();
      reader.onload = (e) => resolve(new DataView(e.target.result));
      reader.onerror = (e) => reject(e);
      reader.readAsArrayBuffer(blob);
    });
  }

  /**
   * Parse video file using fast container detection
   */
  static async parseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    
    try {
      if (ext === 'mkv' || ext === 'webm') {
        return await this.parseMKV(file);
      } else if (['mp4', 'm4v', 'mov'].includes(ext)) {
        return await this.parseMP4(file);
      }
    } catch (err) {
      console.warn('FastHeaderParser notice:', err);
    }
    return null; // Return null to fallback to MediaInfo WASM if header parse is inconclusive
  }

  // ==========================================
  // MKV / EBML PARSER
  // ==========================================
  static async parseMKV(file) {
    // Read first 512 KB of file
    const dataView = await this.readFileSlice(file, 0, 512 * 1024);
    const buf = new Uint8Array(dataView.buffer);
    
    // Check EBML Header Signature 0x1A 0x45 0xDF 0xA3
    if (buf[0] !== 0x1A || buf[1] !== 0x45 || buf[2] !== 0xDF || buf[3] !== 0xA3) {
      return null;
    }

    const subtitles = [];
    let audioCount = 0;
    let videoCount = 0;

    let offset = 0;
    const len = buf.length;

    // Helper functions for VINT parsing
    const readVint = (pos) => {
      if (pos >= len) return null;
      const b0 = buf[pos];
      let length = 1;
      let mask = 0x80;
      while (length <= 8 && !(b0 & mask)) {
        length++;
        mask >>= 1;
      }
      if (length > 8 || pos + length > len) return null;
      let val = b0 & (mask - 1);
      for (let i = 1; i < length; i++) {
        val = (val * 256) + buf[pos + i];
      }
      return { value: val, length };
    };

    const readElementId = (pos) => {
      if (pos >= len) return null;
      const b0 = buf[pos];
      let length = 1;
      let mask = 0x80;
      while (length <= 4 && !(b0 & mask)) {
        length++;
        mask >>= 1;
      }
      if (length > 4 || pos + length > len) return null;
      let id = 0;
      for (let i = 0; i < length; i++) {
        id = (id << 8) | buf[pos + i];
      }
      return { id: id >>> 0, length };
    };

    // Fast search for Tracks Element ID: 0x1654AE6B
    let tracksPos = -1;
    for (let i = 0; i < len - 4; i++) {
      if (buf[i] === 0x16 && buf[i+1] === 0x54 && buf[i+2] === 0xAE && buf[i+3] === 0x6B) {
        tracksPos = i;
        break;
      }
    }

    if (tracksPos !== -1) {
      const elementIdInfo = readElementId(tracksPos);
      const sizeInfo = readVint(tracksPos + elementIdInfo.length);
      if (sizeInfo) {
        let cursor = tracksPos + elementIdInfo.length + sizeInfo.length;
        const tracksEnd = Math.min(cursor + sizeInfo.value, len);

        // Iterate TrackEntry elements (ID 0xAE)
        while (cursor < tracksEnd - 2) {
          const el = readElementId(cursor);
          if (!el) break;
          const sz = readVint(cursor + el.length);
          if (!sz) break;

          const entryStart = cursor + el.length + sz.length;
          const entryEnd = Math.min(entryStart + sz.value, tracksEnd);

          if (el.id === 0xAE) { // TrackEntry
            let trackType = 0;
            let codecId = 'Unknown';
            let language = 'und';
            let trackName = '';
            let isDefault = false;
            let isForced = false;

            let tc = entryStart;
            while (tc < entryEnd - 1) {
              const subEl = readElementId(tc);
              if (!subEl) break;
              const subSz = readVint(tc + subEl.length);
              if (!subSz) break;

              const valPos = tc + subEl.length + subSz.length;
              const valLen = subSz.value;

              if (valPos + valLen > entryEnd) break;

              // TrackType 0x83
              if (subEl.id === 0x83 && valLen >= 1) {
                trackType = buf[valPos];
              }
              // CodecID 0x86
              else if (subEl.id === 0x86) {
                codecId = new TextDecoder('ascii').decode(buf.subarray(valPos, valPos + valLen));
              }
              // Language 0x22B59C
              else if (subEl.id === 0x22B59C) {
                language = new TextDecoder('ascii').decode(buf.subarray(valPos, valPos + valLen)).replace(/\0/g, '');
              }
              // Name 0x536E
              else if (subEl.id === 0x536E) {
                trackName = new TextDecoder('utf-8').decode(buf.subarray(valPos, valPos + valLen)).replace(/\0/g, '');
              }
              // FlagDefault 0x55EE
              else if (subEl.id === 0x55EE && valLen >= 1) {
                isDefault = buf[valPos] === 1;
              }
              // FlagForced 0x55E8
              else if (subEl.id === 0x55E8 && valLen >= 1) {
                isForced = buf[valPos] === 1;
              }

              tc = valPos + valLen;
            }

            if (trackType === 1) videoCount++;
            if (trackType === 2) audioCount++;
            if (trackType === 0x11 || trackType === 17) { // Subtitle Track
              let format = 'SRT';
              if (codecId.includes('ASS') || codecId.includes('SSA')) format = 'ASS/SSA';
              else if (codecId.includes('PGS') || codecId.includes('HDMV')) format = 'PGS';
              else if (codecId.includes('VOBSUB')) format = 'VobSub';
              else if (codecId.includes('UTF8')) format = 'SubRip (SRT)';
              else format = codecId.replace('S_', '');

              subtitles.push({
                trackId: subtitles.length + 1,
                format: format,
                codec: codecId,
                language: language || 'und',
                title: trackName,
                isDefault: isDefault,
                isForced: isForced
              });
            }
          }
          cursor = entryEnd;
        }
      }
    }

    return {
      container: 'MKV',
      hasSubtitles: subtitles.length > 0,
      subtitles: subtitles,
      videoTracksCount: videoCount || 1,
      audioTracksCount: audioCount || 1,
      parsedBy: 'Fast Native EBML Engine'
    };
  }

  // ==========================================
  // MP4 / ISO-BMFF BOX PARSER
  // ==========================================
  static async parseMP4(file) {
    // Read initial 256 KB header block
    const dataView = await this.readFileSlice(file, 0, 256 * 1024);
    const buf = new Uint8Array(dataView.buffer);
    
    // Check ftyp or moov atom
    let offset = 0;
    const len = buf.length;
    const subtitles = [];
    let audioCount = 0;
    let videoCount = 0;

    const readBoxHeader = (pos) => {
      if (pos + 8 > len) return null;
      const size = (buf[pos] << 24) | (buf[pos+1] << 16) | (buf[pos+2] << 8) | buf[pos+3];
      const type = String.fromCharCode(buf[pos+4], buf[pos+5], buf[pos+6], buf[pos+7]);
      return { size: size >>> 0, type, headerLen: 8 };
    };

    // Scan top-level boxes for 'moov'
    let moovPos = -1;
    let moovSize = 0;
    let curr = 0;
    while (curr < len - 8) {
      const box = readBoxHeader(curr);
      if (!box || box.size < 8) break;
      if (box.type === 'moov') {
        moovPos = curr + 8;
        moovSize = box.size - 8;
        break;
      }
      curr += box.size;
    }

    if (moovPos !== -1) {
      let moovCursor = moovPos;
      const moovEnd = Math.min(moovPos + moovSize, len);

      while (moovCursor < moovEnd - 8) {
        const box = readBoxHeader(moovCursor);
        if (!box || box.size < 8) break;

        if (box.type === 'trak') { // Track atom
          let trakCursor = moovCursor + 8;
          const trakEnd = Math.min(moovCursor + box.size, moovEnd);
          let handlerType = '';
          let subFormat = 'tx3g';
          let langCode = 'und';

          while (trakCursor < trakEnd - 8) {
            const subBox = readBoxHeader(trakCursor);
            if (!subBox || subBox.size < 8) break;

            if (subBox.type === 'mdia') {
              let mdiaCursor = trakCursor + 8;
              const mdiaEnd = Math.min(trakCursor + subBox.size, trakEnd);
              
              while (mdiaCursor < mdiaEnd - 8) {
                const mBox = readBoxHeader(mdiaCursor);
                if (!mBox || mBox.size < 8) break;

                // hdlr (Handler reference)
                if (mBox.type === 'hdlr') {
                  const hdlrPos = mdiaCursor + 8;
                  if (hdlrPos + 16 <= len) {
                    handlerType = String.fromCharCode(buf[hdlrPos+8], buf[hdlrPos+9], buf[hdlrPos+10], buf[hdlrPos+11]);
                  }
                }
                // mdhd (Media Header) for language
                else if (mBox.type === 'mdhd') {
                  const mdhdPos = mdiaCursor + 8;
                  const version = buf[mdhdPos];
                  const langOffset = version === 1 ? mdhdPos + 20 : mdhdPos + 12;
                  if (langOffset + 2 <= len) {
                    const langVal = (buf[langOffset] << 8) | buf[langOffset+1];
                    const char1 = String.fromCharCode(((langVal >> 10) & 0x1F) + 0x60);
                    const char2 = String.fromCharCode(((langVal >> 5) & 0x1F) + 0x60);
                    const char3 = String.fromCharCode((langVal & 0x1F) + 0x60);
                    langCode = `${char1}${char2}${char3}`;
                  }
                }
                mdiaCursor += mBox.size;
              }
            }
            trakCursor += subBox.size;
          }

          if (handlerType === 'vide') videoCount++;
          if (handlerType === 'soun') audioCount++;
          if (['subt', 'text', 'sbtl'].includes(handlerType)) { // Subtitle track!
            subtitles.push({
              trackId: subtitles.length + 1,
              format: 'MOV_TEXT (tx3g)',
              codec: handlerType,
              language: langCode || 'und',
              title: 'Embedded MP4 Subtitle',
              isDefault: false,
              isForced: false
            });
          }
        }
        moovCursor += box.size;
      }
    }

    return {
      container: 'MP4',
      hasSubtitles: subtitles.length > 0,
      subtitles: subtitles,
      videoTracksCount: videoCount || 1,
      audioTracksCount: audioCount || 1,
      parsedBy: 'Fast Native MP4 Engine'
    };
  }
}
