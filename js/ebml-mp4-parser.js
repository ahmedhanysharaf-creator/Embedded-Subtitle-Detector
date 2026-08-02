/**
 * Fast Native JS Container Header & Tail Parser for MKV (EBML) & MP4 (ISO-BMFF)
 * Provides instant client-side detection of embedded subtitle streams, searching both header & tail moov atoms.
 */

const LANG_MAP = {
  'ara': 'Arabic (العربية)',
  'ar': 'Arabic (العربية)',
  'arb': 'Arabic (العربية)',
  'eng': 'English',
  'en': 'English',
  'fre': 'French',
  'fra': 'French',
  'fr': 'French',
  'spa': 'Spanish',
  'es': 'Spanish',
  'ger': 'German',
  'deu': 'German',
  'de': 'German',
  'ita': 'Italian',
  'it': 'Italian',
  'rus': 'Russian',
  'ru': 'Russian',
  'zho': 'Chinese',
  'chi': 'Chinese',
  'zh': 'Chinese',
  'jpn': 'Japanese',
  'ja': 'Japanese',
  'kor': 'Korean',
  'ko': 'Korean',
  'por': 'Portuguese',
  'pt': 'Portuguese',
  'tur': 'Turkish',
  'tr': 'Turkish',
  'dut': 'Dutch',
  'nld': 'Dutch',
  'nl': 'Dutch',
  'swe': 'Swedish',
  'sv': 'Swedish',
  'nor': 'Norwegian',
  'no': 'Norwegian',
  'dan': 'Danish',
  'da': 'Danish',
  'fin': 'Finnish',
  'fi': 'Finnish',
  'pol': 'Polish',
  'pl': 'Polish',
  'gre': 'Greek',
  'ell': 'Greek',
  'el': 'Greek',
  'heb': 'Hebrew',
  'he': 'Hebrew',
  'hin': 'Hindi',
  'hi': 'Hindi',
  'ind': 'Indonesian',
  'id': 'Indonesian',
  'tha': 'Thai',
  'th': 'Thai',
  'vie': 'Vietnamese',
  'vi': 'Vietnamese',
  'und': 'Undefined'
};

class FastHeaderParser {
  
  static formatLanguage(code) {
    if (!code) return 'Undefined';
    const clean = String(code).trim().toLowerCase().replace(/[^a-z]/g, '');
    if (LANG_MAP[clean]) return LANG_MAP[clean];
    if (LANG_MAP[clean.slice(0, 3)]) return LANG_MAP[clean.slice(0, 3)];
    if (LANG_MAP[clean.slice(0, 2)]) return LANG_MAP[clean.slice(0, 2)];
    return code.toUpperCase();
  }

  static readFileSlice(file, start = 0, length = 512 * 1024) {
    return new Promise((resolve, reject) => {
      const actualStart = Math.max(0, Math.min(start, file.size));
      const actualLength = Math.min(length, file.size - actualStart);
      if (actualLength <= 0) {
        resolve(new DataView(new ArrayBuffer(0)));
        return;
      }
      const blob = file.slice(actualStart, actualStart + actualLength);
      const reader = new FileReader();
      reader.onload = (e) => resolve(new DataView(e.target.result));
      reader.onerror = (e) => reject(e);
      reader.readAsArrayBuffer(blob);
    });
  }

  static indexOfBytes(buf, search) {
    const max = buf.length - search.length;
    for (let i = 0; i <= max; i++) {
      let match = true;
      for (let j = 0; j < search.length; j++) {
        if (buf[i + j] !== search[j]) {
          match = false;
          break;
        }
      }
      if (match) return i;
    }
    return -1;
  }

  static async parseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'mkv' || ext === 'webm') {
        return await this.parseMKV(file);
      } else if (['mp4', 'm4v', 'mov', '3gp'].includes(ext)) {
        return await this.parseMP4(file);
      }
    } catch (err) {
      console.warn('FastHeaderParser notice:', err);
    }
    return null;
  }

  // ==========================================
  // MP4 / ISO-BMFF BOX PARSER (HEADER & TAIL SEARCH)
  // ==========================================
  static async parseMP4(file) {
    const moovData = await this.findMP4MoovBuffer(file);
    if (!moovData) {
      return {
        container: 'MP4',
        hasSubtitles: false,
        subtitles: [],
        videoTracksCount: 1,
        audioTracksCount: 1,
        parsedBy: 'Fast Native MP4 Engine (moov not found)'
      };
    }

    const buf = moovData;
    const len = buf.length;
    const subtitles = [];
    let audioCount = 0;
    let videoCount = 0;

    const readBoxHeader = (pos) => {
      if (pos + 8 > len) return null;
      const size = (buf[pos] << 24) | (buf[pos+1] << 16) | (buf[pos+2] << 8) | buf[pos+3];
      const type = String.fromCharCode(buf[pos+4], buf[pos+5], buf[pos+6], buf[pos+7]);
      return { size: size >>> 0, type };
    };

    // Scan for 'trak' boxes inside 'moov'
    let cursor = 8; // skip moov box header
    while (cursor < len - 8) {
      const box = readBoxHeader(cursor);
      if (!box || box.size < 8 || cursor + box.size > len) break;

      if (box.type === 'trak') {
        let trakCursor = cursor + 8;
        const trakEnd = cursor + box.size;
        let handlerType = '';
        let langCode = 'und';
        let sampleFormat = '';

        while (trakCursor < trakEnd - 8) {
          const subBox = readBoxHeader(trakCursor);
          if (!subBox || subBox.size < 8 || trakCursor + subBox.size > trakEnd) break;

          if (subBox.type === 'mdia') {
            let mdiaCursor = trakCursor + 8;
            const mdiaEnd = trakCursor + subBox.size;
            
            while (mdiaCursor < mdiaEnd - 8) {
              const mBox = readBoxHeader(mdiaCursor);
              if (!mBox || mBox.size < 8 || mdiaCursor + mBox.size > mdiaEnd) break;

              // hdlr (Handler Reference)
              if (mBox.type === 'hdlr') {
                const hdlrPos = mdiaCursor + 8;
                if (hdlrPos + 12 <= len) {
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
              // minf -> stbl -> stsd for sample format
              else if (mBox.type === 'minf') {
                let minfCursor = mdiaCursor + 8;
                const minfEnd = mdiaCursor + mBox.size;
                while (minfCursor < minfEnd - 8) {
                  const minfBox = readBoxHeader(minfCursor);
                  if (!minfBox || minfBox.size < 8 || minfCursor + minfBox.size > minfEnd) break;
                  if (minfBox.type === 'stbl') {
                    let stblCursor = minfCursor + 8;
                    const stblEnd = minfCursor + minfBox.size;
                    while (stblCursor < stblEnd - 8) {
                      const stblBox = readBoxHeader(stblCursor);
                      if (!stblBox || stblBox.size < 8) break;
                      if (stblBox.type === 'stsd' && stblCursor + 16 <= len) {
                        sampleFormat = String.fromCharCode(buf[stblCursor+16], buf[stblCursor+17], buf[stblCursor+18], buf[stblCursor+19]);
                      }
                      stblCursor += stblBox.size;
                    }
                  }
                  minfCursor += minfBox.size;
                }
              }

              mdiaCursor += mBox.size;
            }
          }
          trakCursor += subBox.size;
        }

        const isSubtitleHandler = ['subt', 'text', 'sbtl', 'clcp', 'tx3g', 'c608', 'c708', 'wvtt', 'subp', 'p608'].includes(handlerType.toLowerCase());
        const isSubtitleFormat = ['tx3g', 'wvtt', 'stpp', 'mp4s', 'c608', 'c708', 'subp', 'sbtl', 'text'].includes(sampleFormat.toLowerCase());

        if (handlerType === 'vide') videoCount++;
        else if (handlerType === 'soun') audioCount++;
        else if (isSubtitleHandler || isSubtitleFormat) {
          let formatDisplay = 'MOV_TEXT (tx3g)';
          const fmtLower = (sampleFormat || handlerType).toLowerCase();
          if (fmtLower.includes('wvtt')) formatDisplay = 'WebVTT';
          else if (fmtLower.includes('stpp') || fmtLower.includes('xml')) formatDisplay = 'TTML / XML';
          else if (fmtLower.includes('c608') || fmtLower.includes('c708') || fmtLower.includes('clcp')) formatDisplay = 'CEA-608/708 Closed Captions';
          else if (fmtLower.includes('subp')) formatDisplay = 'VobSub';

          subtitles.push({
            trackId: subtitles.length + 1,
            format: formatDisplay,
            codec: sampleFormat || handlerType,
            language: this.formatLanguage(langCode),
            title: `Embedded MP4 Subtitle #${subtitles.length + 1}`,
            isDefault: false,
            isForced: false
          });
        }
      }
      cursor += box.size;
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

  /**
   * Fast locator for MP4 'moov' atom across header, tail, and top-level box scan
   */
  static async findMP4MoovBuffer(file) {
    // 1. Read head chunk (512 KB)
    const headView = await this.readFileSlice(file, 0, 512 * 1024);
    const headBuf = new Uint8Array(headView.buffer);
    let moovIdx = this.indexOfBytes(headBuf, [109, 111, 111, 118]); // 'moov'

    if (moovIdx !== -1 && moovIdx >= 4) {
      const boxStart = moovIdx - 4;
      const boxSize = ((headBuf[boxStart] << 24) | (headBuf[boxStart+1] << 16) | (headBuf[boxStart+2] << 8) | headBuf[boxStart+3]) >>> 0;
      if (boxSize >= 8 && boxStart + boxSize <= headBuf.length) {
        return headBuf.subarray(boxStart, boxStart + boxSize);
      } else if (boxSize >= 8) {
        const fullSlice = await this.readFileSlice(file, boxStart, Math.min(boxSize, 15 * 1024 * 1024));
        return new Uint8Array(fullSlice.buffer);
      }
    }

    // 2. Read tail chunk (2 MB) - MP4 movies frequently place 'moov' after 'mdat' at the end of the file!
    const tailLength = Math.min(file.size, 2 * 1024 * 1024);
    const tailStart = file.size - tailLength;
    const tailView = await this.readFileSlice(file, tailStart, tailLength);
    const tailBuf = new Uint8Array(tailView.buffer);
    moovIdx = this.indexOfBytes(tailBuf, [109, 111, 111, 118]);

    if (moovIdx !== -1 && moovIdx >= 4) {
      const boxStart = moovIdx - 4;
      const boxSize = ((tailBuf[boxStart] << 24) | (tailBuf[boxStart+1] << 16) | (tailBuf[boxStart+2] << 8) | tailBuf[boxStart+3]) >>> 0;
      if (boxSize >= 8 && boxStart + boxSize <= tailBuf.length) {
        return tailBuf.subarray(boxStart, boxStart + boxSize);
      } else if (boxSize >= 8) {
        const absBoxStart = tailStart + boxStart;
        const fullSlice = await this.readFileSlice(file, absBoxStart, Math.min(boxSize, 15 * 1024 * 1024));
        return new Uint8Array(fullSlice.buffer);
      }
    }

    // 3. Step through top-level boxes if moov is somewhere in the middle
    let pos = 0;
    let attempts = 0;
    while (pos < file.size - 8 && attempts < 30) {
      attempts++;
      const hdrView = await this.readFileSlice(file, pos, 16);
      if (hdrView.byteLength < 8) break;
      const hdrBuf = new Uint8Array(hdrView.buffer);
      let size = ((hdrBuf[0] << 24) | (hdrBuf[1] << 16) | (hdrBuf[2] << 8) | hdrBuf[3]) >>> 0;
      const type = String.fromCharCode(hdrBuf[4], hdrBuf[5], hdrBuf[6], hdrBuf[7]);

      if (size === 1 && hdrBuf.length >= 16) {
        const high = (hdrBuf[8] << 24) | (hdrBuf[9] << 16) | (hdrBuf[10] << 8) | hdrBuf[11];
        const low = (hdrBuf[12] << 24) | (hdrBuf[13] << 16) | (hdrBuf[14] << 8) | hdrBuf[15];
        size = (high * 4294967296) + (low >>> 0);
      }

      if (type === 'moov') {
        const moovSlice = await this.readFileSlice(file, pos, Math.min(size, 15 * 1024 * 1024));
        return new Uint8Array(moovSlice.buffer);
      }

      if (size <= 0) break;
      pos += size;
    }

    return null;
  }

  // ==========================================
  // MKV / EBML PARSER
  // ==========================================
  static async parseMKV(file) {
    const dataView = await this.readFileSlice(file, 0, 1024 * 1024); // 1 MB
    const buf = new Uint8Array(dataView.buffer);
    
    // Check EBML Header Signature 0x1A 0x45 0xDF 0xA3
    if (buf[0] !== 0x1A || buf[1] !== 0x45 || buf[2] !== 0xDF || buf[3] !== 0xA3) {
      return null;
    }

    const subtitles = [];
    let audioCount = 0;
    let videoCount = 0;

    const readVint = (pos) => {
      if (pos >= buf.length) return null;
      const b0 = buf[pos];
      let length = 1;
      let mask = 0x80;
      while (length <= 8 && !(b0 & mask)) {
        length++;
        mask >>= 1;
      }
      if (length > 8 || pos + length > buf.length) return null;
      let val = b0 & (mask - 1);
      for (let i = 1; i < length; i++) {
        val = (val * 256) + buf[pos + i];
      }
      return { value: val, length };
    };

    const readElementId = (pos) => {
      if (pos >= buf.length) return null;
      const b0 = buf[pos];
      let length = 1;
      let mask = 0x80;
      while (length <= 4 && !(b0 & mask)) {
        length++;
        mask >>= 1;
      }
      if (length > 4 || pos + length > buf.length) return null;
      let id = 0;
      for (let i = 0; i < length; i++) {
        id = (id << 8) | buf[pos + i];
      }
      return { id: id >>> 0, length };
    };

    // Fast search for Tracks Element ID: 0x1654AE6B
    let tracksPos = -1;
    for (let i = 0; i < buf.length - 4; i++) {
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
        const tracksEnd = Math.min(cursor + sizeInfo.value, buf.length);

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

              if (subEl.id === 0x83 && valLen >= 1) trackType = buf[valPos];
              else if (subEl.id === 0x86) codecId = new TextDecoder('ascii').decode(buf.subarray(valPos, valPos + valLen));
              else if (subEl.id === 0x22B59C || subEl.id === 0x22B59D) language = new TextDecoder('ascii').decode(buf.subarray(valPos, valPos + valLen)).replace(/\0/g, '');
              else if (subEl.id === 0x536E) trackName = new TextDecoder('utf-8').decode(buf.subarray(valPos, valPos + valLen)).replace(/\0/g, '');
              else if (subEl.id === 0x55EE && valLen >= 1) isDefault = buf[valPos] === 1;
              else if (subEl.id === 0x55E8 && valLen >= 1) isForced = buf[valPos] === 1;

              tc = valPos + valLen;
            }

            if (trackType === 1) videoCount++;
            if (trackType === 2) audioCount++;
            if (trackType === 0x11 || trackType === 17 || trackType === 0x20) {
              let format = 'SRT';
              if (codecId.includes('ASS') || codecId.includes('SSA')) format = 'ASS / SSA';
              else if (codecId.includes('PGS') || codecId.includes('HDMV')) format = 'PGS (HDMV)';
              else if (codecId.includes('VOBSUB')) format = 'VobSub';
              else if (codecId.includes('UTF8')) format = 'SubRip (SRT)';
              else format = codecId.replace('S_', '');

              subtitles.push({
                trackId: subtitles.length + 1,
                format: format,
                codec: codecId,
                language: this.formatLanguage(language),
                title: trackName || `Track #${subtitles.length + 1}`,
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
}
