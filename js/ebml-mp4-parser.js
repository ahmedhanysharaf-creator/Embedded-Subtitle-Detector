/**
 * Fast Native JS Container Header & Tail Parser for MKV (EBML) & MP4 (ISO-BMFF)
 * Provides instant client-side detection of embedded subtitle streams, searching both header & tail moov atoms.
 */

const LANG_MAP = {
  'ara': 'Arabic (العربية)', 'ar': 'Arabic (العربية)', 'arb': 'Arabic (العربية)',
  'eng': 'English', 'en': 'English',
  'fre': 'French', 'fra': 'French', 'fr': 'French',
  'spa': 'Spanish', 'es': 'Spanish',
  'ger': 'German', 'deu': 'German', 'de': 'German',
  'ita': 'Italian', 'it': 'Italian',
  'rus': 'Russian', 'ru': 'Russian',
  'zho': 'Chinese', 'chi': 'Chinese', 'zh': 'Chinese',
  'jpn': 'Japanese', 'ja': 'Japanese',
  'kor': 'Korean', 'ko': 'Korean',
  'por': 'Portuguese', 'pt': 'Portuguese',
  'tur': 'Turkish', 'tr': 'Turkish',
  'dut': 'Dutch', 'nld': 'Dutch', 'nl': 'Dutch',
  'swe': 'Swedish', 'sv': 'Swedish',
  'nor': 'Norwegian', 'no': 'Norwegian',
  'dan': 'Danish', 'da': 'Danish',
  'fin': 'Finnish', 'fi': 'Finnish',
  'pol': 'Polish', 'pl': 'Polish',
  'gre': 'Greek', 'ell': 'Greek', 'el': 'Greek',
  'heb': 'Hebrew', 'he': 'Hebrew',
  'hin': 'Hindi', 'hi': 'Hindi',
  'ind': 'Indonesian', 'id': 'Indonesian',
  'tha': 'Thai', 'th': 'Thai',
  'vie': 'Vietnamese', 'vi': 'Vietnamese',
  'cze': 'Czech', 'ces': 'Czech', 'cs': 'Czech',
  'ron': 'Romanian', 'rum': 'Romanian', 'ro': 'Romanian',
  'und': 'Undefined'
};

class FastHeaderParser {
  
  static formatLanguage(code) {
    if (!code || code === 'und') return 'Undefined';
    const clean = String(code).trim().toLowerCase().replace(/[^a-z]/g, '');
    if (LANG_MAP[clean]) return LANG_MAP[clean];
    if (LANG_MAP[clean.slice(0, 3)]) return LANG_MAP[clean.slice(0, 3)];
    if (LANG_MAP[clean.slice(0, 2)]) return LANG_MAP[clean.slice(0, 2)];
    return code.toUpperCase();
  }

  static decodeMp4Lang(langVal) {
    if (!langVal || langVal === 0 || langVal === 0x55C3) return 'und';
    const c1 = (langVal >> 10) & 0x1F;
    const c2 = (langVal >> 5) & 0x1F;
    const c3 = langVal & 0x1F;
    if (c1 === 0 || c2 === 0 || c3 === 0) return 'und';
    const char1 = String.fromCharCode(c1 + 0x60);
    const char2 = String.fromCharCode(c2 + 0x60);
    const char3 = String.fromCharCode(c3 + 0x60);
    const lang = `${char1}${char2}${char3}`;
    if (!/^[a-z]{3}$/.test(lang)) return 'und';
    return lang;
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
        parsedBy: 'Fast Native MP4 Engine'
      };
    }

    const buf = moovData;
    const len = buf.length;
    const subtitles = [];
    let audioCount = 0;
    let videoCount = 0;

    const readBoxHeader = (pos) => {
      if (pos + 8 > len) return null;
      const size = (buf[pos] * 16777216) + (buf[pos+1] << 16) + (buf[pos+2] << 8) + buf[pos+3];
      const type = String.fromCharCode(buf[pos+4], buf[pos+5], buf[pos+6], buf[pos+7]);
      return { size: size, type };
    };

    let cursor = 8;
    while (cursor < len - 8) {
      const box = readBoxHeader(cursor);
      if (!box || box.size < 8 || cursor + box.size > len) {
        // If box size extends past buffer or invalid, advance cursor by 4 or break
        if (!box || box.size < 8) break;
        cursor += 4;
        continue;
      }

      if (box.type === 'trak') {
        const trakBuf = buf.subarray(cursor, cursor + box.size);
        let handlerType = '';
        let langCode = 'und';
        let sampleFormat = '';
        let isChapterTrack = false;
        let isSubtitleTrack = false;

        for (let j = 0; j < trakBuf.length - 8; j++) {
          const subType = String.fromCharCode(trakBuf[j+4], trakBuf[j+5], trakBuf[j+6], trakBuf[j+7]);

          if (subType === 'hdlr' && j + 20 <= trakBuf.length) {
            const str1 = String.fromCharCode(trakBuf[j+12], trakBuf[j+13], trakBuf[j+14], trakBuf[j+15]).toLowerCase();
            const str2 = String.fromCharCode(trakBuf[j+16], trakBuf[j+17], trakBuf[j+18], trakBuf[j+19]).toLowerCase();
            
            if (str1 === 'vide' || str2 === 'vide') handlerType = 'vide';
            else if (str1 === 'soun' || str2 === 'soun') handlerType = 'soun';
            else {
              const subCandidate = [str1, str2].find(s => ['subt', 'sbtl', 'text', 'tx3g', 'clcp', 'wvtt', 'subp', 'p608'].includes(s));
              if (subCandidate) {
                handlerType = subCandidate;
                isSubtitleTrack = true;
              }
            }
          }

          if (subType === 'mdhd' && j + 24 <= trakBuf.length) {
            const version = trakBuf[j+8];
            const langOffset = version === 1 ? j + 28 : j + 20;
            if (langOffset + 2 <= trakBuf.length) {
              const langVal = (trakBuf[langOffset] << 8) | trakBuf[langOffset+1];
              langCode = this.decodeMp4Lang(langVal);
            }
          }

          if (subType === 'stsd' && j + 20 <= trakBuf.length) {
            const rawFmt = String.fromCharCode(trakBuf[j+16], trakBuf[j+17], trakBuf[j+18], trakBuf[j+19]);
            if (/^[a-zA-Z0-9_-]{3,4}$/.test(rawFmt)) {
              sampleFormat = rawFmt;
            }
          }

          if (subType === 'chap' || subType === 'chpl') {
            isChapterTrack = true;
          }
        }

        const hLower = handlerType.toLowerCase();
        const sLower = sampleFormat.toLowerCase();

        if (hLower === 'vide') videoCount++;
        else if (hLower === 'soun') audioCount++;

        const isSubHandler = ['subt', 'sbtl', 'text', 'tx3g', 'clcp', 'wvtt', 'subp', 'p608'].includes(hLower);
        const isSubFormat = ['tx3g', 'wvtt', 'stpp', 'mp4s', 'c608', 'c708', 'subp', 'sbtl'].includes(sLower);

        if ((isSubtitleTrack || isSubHandler || isSubFormat) && !isChapterTrack) {
          let formatDisplay = 'MOV_TEXT (tx3g)';
          if (sLower.includes('wvtt') || hLower.includes('wvtt')) formatDisplay = 'WebVTT';
          else if (sLower.includes('stpp') || sLower.includes('xml')) formatDisplay = 'TTML / XML';
          else if (sLower.includes('c608') || sLower.includes('c708') || hLower.includes('clcp')) formatDisplay = 'CEA-608/708 Closed Captions';
          else if (sLower.includes('subp') || hLower.includes('subp')) formatDisplay = 'VobSub';

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
   * Fast locator for MP4 'moov' atom across header and tail slices (instant non-blocking)
   */
  static async findMP4MoovBuffer(file) {
    // 1. Check Header Slice (first 10 MB)
    const headLen = Math.min(file.size, 10 * 1024 * 1024);
    const headView = await this.readFileSlice(file, 0, headLen);
    const headBuf = new Uint8Array(headView.buffer);
    let moovIdx = this.indexOfBytes(headBuf, [109, 111, 111, 118]);

    if (moovIdx !== -1 && moovIdx >= 4) {
      const boxStart = moovIdx - 4;
      const boxSize = (headBuf[boxStart] * 16777216) + (headBuf[boxStart+1] << 16) + (headBuf[boxStart+2] << 8) + headBuf[boxStart+3];
      if (boxSize >= 8 && boxStart + boxSize <= headBuf.length) {
        return headBuf.subarray(boxStart, boxStart + boxSize);
      } else if (boxSize >= 8) {
        const fullSlice = await this.readFileSlice(file, boxStart, Math.min(boxSize, 25 * 1024 * 1024));
        return new Uint8Array(fullSlice.buffer);
      }
    }

    // 2. Check Tail Slice (last 15 MB)
    if (file.size > headLen) {
      const tailLen = Math.min(file.size - headLen, 15 * 1024 * 1024);
      const tailStart = file.size - tailLen;
      const tailView = await this.readFileSlice(file, tailStart, tailLen);
      const tailBuf = new Uint8Array(tailView.buffer);
      moovIdx = this.indexOfBytes(tailBuf, [109, 111, 111, 118]);

      if (moovIdx !== -1 && moovIdx >= 4) {
        const boxStart = moovIdx - 4;
        const boxSize = (tailBuf[boxStart] * 16777216) + (tailBuf[boxStart+1] << 16) + (tailBuf[boxStart+2] << 8) + tailBuf[boxStart+3];
        if (boxSize >= 8 && boxStart + boxSize <= tailBuf.length) {
          return tailBuf.subarray(boxStart, boxStart + boxSize);
        } else if (boxSize >= 8) {
          const absBoxStart = tailStart + boxStart;
          const fullSlice = await this.readFileSlice(file, absBoxStart, Math.min(boxSize, 25 * 1024 * 1024));
          return new Uint8Array(fullSlice.buffer);
        }
      }
    }

    return null;
  }

  // ==========================================
  // MKV / EBML PARSER (ACCURATE TRACKS LOCATOR & FALLBACK SCANNER)
  // ==========================================
  static async parseMKV(file) {
    const sliceLen = Math.min(file.size, 12 * 1024 * 1024); // 12 MB header slice
    const dataView = await this.readFileSlice(file, 0, sliceLen);
    const buf = new Uint8Array(dataView.buffer);
    
    if (buf.length < 4 || buf[0] !== 0x1A || buf[1] !== 0x45 || buf[2] !== 0xDF || buf[3] !== 0xA3) {
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

    // Locate true Tracks element (0x1654AE6B)
    let tracksPos = -1;
    for (let i = 0; i < buf.length - 10; i++) {
      if (buf[i] === 0x16 && buf[i+1] === 0x54 && buf[i+2] === 0xAE && buf[i+3] === 0x6B) {
        tracksPos = i;
        break;
      }
    }

    const parseTrackEntryBuffer = (entryStart, entryEnd) => {
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

      const upperCodec = codecId.toUpperCase();
      const isSub = (trackType === 0x11 || trackType === 17 || trackType === 0x20 || upperCodec.startsWith('S_') || upperCodec.includes('SUB') || upperCodec.includes('ASS') || upperCodec.includes('PGS') || upperCodec.includes('UTF8'));

      if (isSub) {
        let format = 'SRT';
        if (upperCodec.includes('ASS') || upperCodec.includes('SSA')) format = 'ASS / SSA';
        else if (upperCodec.includes('PGS') || upperCodec.includes('HDMV')) format = 'PGS (HDMV)';
        else if (upperCodec.includes('VOBSUB')) format = 'VobSub';
        else if (upperCodec.includes('UTF8') || upperCodec.includes('SUBRIP')) format = 'SubRip (SRT)';
        else format = codecId.replace(/^S_/, '');

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
    };

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
            parseTrackEntryBuffer(entryStart, entryEnd);
          }
          cursor = entryEnd;
        }
      }
    }

    // Fallback: search for any TrackEntry (0xAE) tags directly in the header if subtitles array is empty
    if (subtitles.length === 0) {
      for (let i = 0; i < buf.length - 20; i++) {
        if (buf[i] === 0xAE) {
          const elSz = readVint(i + 1);
          if (elSz && elSz.value > 10 && elSz.value < 2048) {
            const entryStart = i + 1 + elSz.length;
            const entryEnd = Math.min(entryStart + elSz.value, buf.length);
            parseTrackEntryBuffer(entryStart, entryEnd);
            i = entryEnd;
          }
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
