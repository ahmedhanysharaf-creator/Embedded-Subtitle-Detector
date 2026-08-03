/**
 * SubDetect Main Application Controller & UI Store
 * Triple-Detection System (Embedded Softsubs + Sidecar SRT Files + Hardcoded Subtitles)
 */
document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const dropzoneCard = document.getElementById('dropzoneCard');
  const dropzoneSection = document.getElementById('dropzoneSection');
  const folderInput = document.getElementById('folderInput');
  const fileInput = document.getElementById('fileInput');
  const selectFolderBtn = document.getElementById('selectFolderBtn');
  const selectFilesBtn = document.getElementById('selectFilesBtn');
  const resetAppBtn = document.getElementById('resetAppBtn');

  // Progress Section
  const progressSection = document.getElementById('progressSection');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressPercent = document.getElementById('progressPercent');
  const progressSubtext = document.getElementById('progressSubtext');
  const currentScanningFile = document.getElementById('currentScanningFile');

  // Dashboard Section
  const dashboardSection = document.getElementById('dashboardSection');
  const statTotalFiles = document.getElementById('statTotalFiles');
  const statSubtitledCount = document.getElementById('statSubtitledCount');
  const statSoftsubCount = document.getElementById('statSoftsubCount');
  const statSidecarCount = document.getElementById('statSidecarCount');
  const statHardsubCount = document.getElementById('statHardsubCount');

  // Toolbar & Filters
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const filterChips = document.querySelectorAll('.filter-chip');
  const countAll = document.getElementById('countAll');
  const countHasSubs = document.getElementById('countHasSubs');
  const countSoftSubs = document.getElementById('countSoftSubs');
  const countSidecarSubs = document.getElementById('countSidecarSubs');
  const countHardSubs = document.getElementById('countHardSubs');
  const countNoSubs = document.getElementById('countNoSubs');

  // Export & View Toggle
  const exportDropdownBtn = document.getElementById('exportDropdownBtn');
  const exportMenu = document.getElementById('exportMenu');
  const exportCsvBtn = document.getElementById('exportCsvBtn');
  const exportJsonBtn = document.getElementById('exportJsonBtn');
  const copyMissingSubsBtn = document.getElementById('copyMissingSubsBtn');
  const viewGridBtn = document.getElementById('viewGridBtn');
  const viewTableBtn = document.getElementById('viewTableBtn');
  const mediaGrid = document.getElementById('mediaGrid');
  const tableContainer = document.getElementById('tableContainer');
  const mediaTableBody = document.getElementById('mediaTableBody');
  const emptyState = document.getElementById('emptyState');

  // Modal Inspector
  const modalBackdrop = document.getElementById('modalBackdrop');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const modalCloseFooterBtn = document.getElementById('modalCloseFooterBtn');
  const modalMediaTitle = document.getElementById('modalMediaTitle');
  const modalMediaPath = document.getElementById('modalMediaPath');
  const modalSummaryPills = document.getElementById('modalSummaryPills');
  const modalSubtitleTracksList = document.getElementById('modalSubtitleTracksList');
  const modalTechSpecsGrid = document.getElementById('modalTechSpecsGrid');

  // Banner
  const techInsightBanner = document.getElementById('techInsightBanner');
  const closeBannerBtn = document.getElementById('closeBannerBtn');

  // Application State
  let scannedRecords = [];
  let currentFilter = 'all';
  let searchQuery = '';
  let currentView = 'grid';

  // --- INITIALIZATION ---
  window.mediaInfoEngine.init();

  if (closeBannerBtn) {
    closeBannerBtn.addEventListener('click', () => {
      techInsightBanner.classList.add('hidden');
    });
  }

  // --- EVENT LISTENERS FOR SELECTION & DRAG DROP ---
  selectFolderBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const scanData = await window.mediaScanner.pickDirectory();
    if (scanData && (scanData.videoFiles.length > 0 || scanData.subtitleFiles.length > 0)) {
      startScanning(scanData);
    } else {
      folderInput.click();
    }
  });

  selectFilesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  folderInput.addEventListener('change', (e) => {
    const scanData = window.mediaScanner.processFileList(e.target.files);
    if (scanData.videoFiles.length > 0) startScanning(scanData);
  });

  fileInput.addEventListener('change', (e) => {
    const scanData = window.mediaScanner.processFileList(e.target.files);
    if (scanData.videoFiles.length > 0) startScanning(scanData);
  });

  // Drag & Drop
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzoneCard.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzoneCard.classList.add('drag-over');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzoneCard.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzoneCard.classList.remove('drag-over');
    }, false);
  });

  dropzoneCard.addEventListener('drop', async (e) => {
    const dt = e.dataTransfer;
    if (dt.items && dt.items.length > 0) {
      const scanData = await window.mediaScanner.processDataTransferItems(dt.items);
      if (scanData.videoFiles.length > 0) startScanning(scanData);
    } else if (dt.files && dt.files.length > 0) {
      const scanData = window.mediaScanner.processFileList(dt.files);
      if (scanData.videoFiles.length > 0) startScanning(scanData);
    }
  });

  resetAppBtn.addEventListener('click', () => {
    scannedRecords = [];
    dropzoneSection.classList.remove('hidden');
    progressSection.classList.add('hidden');
    dashboardSection.classList.add('hidden');
    folderInput.value = '';
    fileInput.value = '';
  });

  // --- SCANNING WORKFLOW ---
  async function startScanning(scanData) {
    scannedRecords = [];
    dropzoneSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');

    const total = scanData.videoFiles ? scanData.videoFiles.length : 0;
    progressBarFill.style.width = '0%';
    progressPercent.textContent = '0%';
    progressSubtext.textContent = `Processing 0 of ${total} video files`;

    await window.mediaScanner.scanBatch(
      scanData,
      (prog) => {
        progressBarFill.style.width = `${prog.percent}%`;
        progressPercent.textContent = `${prog.percent}%`;
        progressSubtext.textContent = `Scanning file ${prog.currentIndex} of ${prog.totalFiles}`;
        currentScanningFile.textContent = prog.currentFileName;
      },
      (record) => {
        scannedRecords.push(record);
      }
    );

    // Scan Complete
    progressSection.classList.add('hidden');
    dashboardSection.classList.remove('hidden');
    updateDashboard();
  }

  // --- DASHBOARD & STATS UPDATE ---
  function updateDashboard() {
    const total = scannedRecords.length;
    const subtitled = scannedRecords.filter(r => r.subStatus === 'has-subs');
    const nosubs = scannedRecords.filter(r => r.subStatus === 'no-subs');

    const statNoSubCount = document.getElementById('statNoSubCount');

    if (statTotalFiles) statTotalFiles.textContent = total;
    if (statSubtitledCount) statSubtitledCount.textContent = subtitled.length;
    if (statNoSubCount) statNoSubCount.textContent = nosubs.length;

    if (countAll) countAll.textContent = total;
    if (countHasSubs) countHasSubs.textContent = subtitled.length;
    if (countNoSubs) countNoSubs.textContent = nosubs.length;

    renderFilteredMedia();
  }

  // --- SEARCH & FILTERING ---
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value.trim().toLowerCase();
    clearSearchBtn.classList.toggle('hidden', searchQuery.length === 0);
    renderFilteredMedia();
  });

  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    clearSearchBtn.classList.add('hidden');
    renderFilteredMedia();
  });

  filterChips.forEach(chip => {
    chip.addEventListener('click', () => {
      filterChips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      currentFilter = chip.dataset.filter;
      renderFilteredMedia();
    });
  });

  function getFilteredRecords() {
    return scannedRecords.filter(record => {
      if (currentFilter === 'has-subs' && record.subStatus !== 'has-subs') return false;
      if (currentFilter === 'no-subs' && record.subStatus !== 'no-subs') return false;

      if (searchQuery) {
        const titleMatch = record.fileName.toLowerCase().includes(searchQuery);
        const pathMatch = record.filePath.toLowerCase().includes(searchQuery);
        const langMatch = record.analysis && record.analysis.subtitles && record.analysis.subtitles.some(s => 
          (s.language && s.language.toLowerCase().includes(searchQuery)) ||
          (s.format && s.format.toLowerCase().includes(searchQuery))
        );
        return titleMatch || pathMatch || langMatch;
      }

      return true;
    });
  }

  // --- RENDER VIEWS ---
  function renderFilteredMedia() {
    const records = getFilteredRecords();
    
    if (records.length === 0) {
      emptyState.classList.remove('hidden');
      mediaGrid.classList.add('hidden');
      tableContainer.classList.add('hidden');
      return;
    }

    emptyState.classList.add('hidden');

    if (currentView === 'grid') {
      mediaGrid.classList.remove('hidden');
      tableContainer.classList.add('hidden');
      renderGrid(records);
    } else {
      mediaGrid.classList.add('hidden');
      tableContainer.classList.remove('hidden');
      renderTable(records);
    }
  }

  function renderGrid(records) {
    mediaGrid.innerHTML = '';
    records.forEach(record => {
      const card = document.createElement('div');
      card.className = 'media-card';

      const ext = record.fileName.split('.').pop().toLowerCase();
      const subs = record.analysis ? record.analysis.subtitles : [];

      let statusBadge = '';
      let trackChipsHtml = '';

      if (record.subStatus === 'has-subs') {
        statusBadge = `<div class="sub-status-badge sub-badge-has" style="background: rgba(16, 185, 129, 0.15); color: var(--success); border: 1px solid rgba(16, 185, 129, 0.3);"><i class="fa-solid fa-circle-check"></i> Built-in Subtitles Included</div>`;
        if (subs.length > 0) {
          const langs = [...new Set(subs.map(s => s.language || 'und'))].slice(0, 4);
          const formats = [...new Set(subs.map(s => s.format))].slice(0, 3);
          trackChipsHtml += langs.map(l => `<span class="track-chip track-chip-lang"><i class="fa-solid fa-globe"></i> ${l.toUpperCase()}</span>`).join('');
          trackChipsHtml += formats.map(f => `<span class="track-chip"><i class="fa-solid fa-file-lines"></i> ${f}</span>`).join('');
        } else {
          trackChipsHtml = `<span class="track-chip track-chip-lang" style="background: rgba(16,185,129,0.2); color: var(--success);"><i class="fa-solid fa-eye"></i> SUBTITLED MOVIE</span>`;
        }
      } else {
        statusBadge = `<div class="sub-status-badge sub-badge-none" style="background: rgba(239, 68, 68, 0.15); color: var(--danger); border: 1px solid rgba(239, 68, 68, 0.3);"><i class="fa-solid fa-circle-xmark"></i> No Subtitles</div>`;
        trackChipsHtml = `<span class="track-chip" style="background: rgba(239,68,68,0.2); color: var(--danger);"><i class="fa-solid fa-ban"></i> RAW MOVIE</span>`;
      }

      let thumbHtml = '';
      if (record.thumbnailDataUrl) {
        thumbHtml = `
          <div class="card-thumb-container">
            <img src="${record.thumbnailDataUrl}" class="card-thumb-img" alt="Frame Sample">
            <span class="thumb-frame-tag"><i class="fa-solid fa-camera"></i> Sampled Frame</span>
          </div>
        `;
      }

      card.innerHTML = `
        ${thumbHtml}
        <div class="media-card-header">
          <div class="media-title-area">
            <div class="media-filename">${escapeHtml(record.fileName)}</div>
            <div class="media-relative-path">${escapeHtml(record.filePath)}</div>
          </div>
          <span class="format-pill format-${ext}">${ext.toUpperCase()}</span>
        </div>
        ${statusBadge}
        <div class="tracks-tags">${trackChipsHtml}</div>
        <div class="media-card-footer">
          <span class="file-size-label"><i class="fa-solid fa-hard-drive"></i> ${record.fileSizeFormatted}</span>
          <div style="display: flex; gap: 0.35rem;">
            <button class="btn btn-outline btn-sm tag-btn" data-id="${record.id}" title="Toggle Category">
              <i class="fa-solid fa-arrows-rotate"></i> ${record.subStatus === 'has-subs' ? 'Move to No Subs' : 'Move to Subtitled'}
            </button>
            <button class="btn btn-primary btn-sm inspect-btn" data-id="${record.id}">
              <i class="fa-solid fa-circle-info"></i> Inspect
            </button>
          </div>
        </div>
      `;

      const tagBtn = card.querySelector('.tag-btn');
      if (tagBtn) {
        tagBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          record.subStatus = (record.subStatus === 'has-subs') ? 'no-subs' : 'has-subs';
          updateDashboard();
        });
      }

      card.querySelector('.inspect-btn').addEventListener('click', () => openModalInspector(record));
      mediaGrid.appendChild(card);
    });
  }

  function renderTable(records) {
    mediaTableBody.innerHTML = '';
    records.forEach(record => {
      const tr = document.createElement('tr');
      const subs = record.analysis ? record.analysis.subtitles : [];
      const ext = record.fileName.split('.').pop().toLowerCase();

      let statusHtml = '';
      if (record.subStatus === 'has-subs') {
        statusHtml = `<span class="text-success" style="font-weight: 600;"><i class="fa-solid fa-circle-check"></i> Built-in Subtitles</span>`;
      } else {
        statusHtml = `<span class="text-danger" style="font-weight: 500;"><i class="fa-solid fa-circle-xmark"></i> No Subtitles</span>`;
      }

      const langs = record.subStatus === 'has-subs' ? (subs.length > 0 ? [...new Set(subs.map(s => s.language || 'und'))].join(', ') : 'Subtitled') : '—';
      const formats = record.subStatus === 'has-subs' ? (subs.length > 0 ? [...new Set(subs.map(s => s.format))].join(', ') : 'Built-in') : '—';

      tr.innerHTML = `
        <td>
          <strong style="color: var(--text-main); display: block;">${escapeHtml(record.fileName)}</strong>
          <span class="media-relative-path">${escapeHtml(record.filePath)}</span>
        </td>
        <td><span class="format-pill format-${ext}">${ext.toUpperCase()}</span></td>
        <td>${statusHtml}</td>
        <td>${escapeHtml(langs)}</td>
        <td>${escapeHtml(formats)}</td>
        <td style="font-family: var(--font-mono); font-size: 0.85rem;">${record.fileSizeFormatted}</td>
        <td>
          <button class="btn btn-outline btn-sm tag-btn" data-id="${record.id}" style="margin-right: 0.25rem;">
            <i class="fa-solid fa-arrows-rotate"></i> ${record.subStatus === 'has-subs' ? 'To No Subs' : 'To Subtitled'}
          </button>
          <button class="btn btn-primary btn-sm inspect-btn" data-id="${record.id}">
            <i class="fa-solid fa-sliders"></i> Details
          </button>
        </td>
      `;

      tr.querySelector('.tag-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        record.subStatus = (record.subStatus === 'has-subs') ? 'no-subs' : 'has-subs';
        updateDashboard();
      });

      tr.querySelector('.inspect-btn').addEventListener('click', () => openModalInspector(record));
      mediaTableBody.appendChild(tr);
    });
  }

  // --- VIEW TOGGLE ---
  viewGridBtn.addEventListener('click', () => {
    currentView = 'grid';
    viewGridBtn.classList.add('active');
    viewTableBtn.classList.remove('active');
    renderFilteredMedia();
  });

  viewTableBtn.addEventListener('click', () => {
    currentView = 'table';
    viewTableBtn.classList.add('active');
    viewGridBtn.classList.remove('active');
    renderFilteredMedia();
  });

  // --- MODAL INSPECTOR & OPTION 3 FRAME SAMPLER ---
  function openModalInspector(record) {
    modalMediaTitle.textContent = record.fileName;
    modalMediaPath.textContent = record.filePath;

    const analysis = record.analysis || {};
    const subs = analysis.subtitles || [];

    // Header Summary Pills
    const ext = record.fileName.split('.').pop().toUpperCase();
    modalSummaryPills.innerHTML = `
      <span class="format-pill format-${ext.toLowerCase()}">${ext} Container</span>
      <span class="track-chip"><i class="fa-solid fa-hard-drive"></i> ${record.fileSizeFormatted}</span>
      <span class="track-chip track-chip-lang"><i class="fa-solid fa-layer-group"></i> ${record.subStatus.toUpperCase()}</span>
      <span class="track-chip"><i class="fa-solid fa-microchip"></i> ${analysis.parsedBy || 'MediaInfo WASM'}</span>
    `;

    // Subtitle Tracks List or Notice
    if (record.subStatus === 'sidecar-subs') {
      modalSubtitleTracksList.innerHTML = `
        <div class="hardsub-notice-card" style="border-color: rgba(79,70,229,0.4); background: rgba(79,70,229,0.1);">
          <div class="notice-icon"><i class="fa-solid fa-file-audio text-accent"></i></div>
          <div class="notice-content">
            <h4 style="color: #a5b4fc;">Sidecar Subtitle File Detected (.srt)</h4>
            <p>Matching sidecar subtitle file(s) found in directory:</p>
            <div class="notice-bullets">
              ${record.sidecarSubs.map(s => `<span>&bull; <strong>${escapeHtml(s)}</strong></span>`).join('')}
            </div>
          </div>
        </div>
      `;
    } else if (subs.length === 0) {
      modalSubtitleTracksList.innerHTML = `
        <div class="hardsub-notice-card">
          <div class="notice-icon"><i class="fa-solid fa-circle-info text-warning"></i></div>
          <div class="notice-content">
            <h4>No Embedded Soft Subtitle Streams Detected</h4>
            <p>This video container has 0 soft subtitle tracks in its header. If subtitles appear on screen when playing, they are <strong>Hardcoded (Burned-in)</strong> into the video frames.</p>
            <div class="notice-bullets">
              <span>&bull; <strong>Softsubs (0 tracks):</strong> Toggleable text streams in container</span>
              <span>&bull; <strong>Hardsubs:</strong> Subtitles baked into video picture</span>
            </div>
          </div>
        </div>
      `;
    } else {
      modalSubtitleTracksList.innerHTML = subs.map(s => `
        <div class="track-item">
          <div class="track-item-info">
            <span class="track-num-badge">#${s.trackId}</span>
            <span class="track-format-tag">${escapeHtml(s.format)}</span>
            <span class="track-lang-label"><i class="fa-solid fa-globe text-accent"></i> ${escapeHtml(s.language)}</span>
            ${s.title ? `<span style="font-size: 0.8rem; color: var(--text-muted);">("${escapeHtml(s.title)}")</span>` : ''}
          </div>
          <div class="track-flags">
            ${s.isDefault ? `<span class="flag-pill">DEFAULT</span>` : ''}
            ${s.isForced ? `<span class="flag-pill" style="background: rgba(239, 68, 68, 0.2); color: var(--danger);">FORCED</span>` : ''}
          </div>
        </div>
      `).join('');
    }

    // Technical Specs Grid
    modalTechSpecsGrid.innerHTML = `
      <div class="spec-box">
        <div class="spec-key">Video Codec</div>
        <div class="spec-val">${analysis.videoCodec || 'H.264 / HEVC'}</div>
      </div>
      <div class="spec-box">
        <div class="spec-key">Resolution</div>
        <div class="spec-val">${analysis.resolution || 'Auto Detected'}</div>
      </div>
      <div class="spec-box">
        <div class="spec-key">Audio Streams</div>
        <div class="spec-val">${analysis.audioTracksCount || 1} Audio Track(s)</div>
      </div>
      <div class="spec-box">
        <div class="spec-key">Container Protocol</div>
        <div class="spec-val">${analysis.container || ext}</div>
      </div>
    `;

    // Append Option 3 Frame Sampler Component
    const frameSection = document.createElement('div');
    frameSection.className = 'modal-section';
    frameSection.style.marginTop = '1.25rem';
    frameSection.innerHTML = `
      <h3 class="modal-section-title"><i class="fa-solid fa-camera text-accent"></i> Live Frame Subtitle Inspection (Option 3)</h3>
      <div style="background: rgba(0,0,0,0.3); border: 1px solid var(--bg-card-border); padding: 1rem; border-radius: 8px;">
        <p style="font-size: 0.85rem; color: var(--text-secondary); margin-bottom: 0.75rem;">Sample a video frame at 20% duration to visually verify Arabic hardcoded subtitles on screen.</p>
        <button class="btn btn-secondary btn-sm" id="captureFrameBtn">
          <i class="fa-solid fa-play text-accent"></i> Capture Frame Subtitle Sample
        </button>
        <div id="framePreviewContainer" class="hidden" style="margin-top: 0.75rem; text-align: center;">
          <video id="sampleVideo" style="display: none;"></video>
          <canvas id="sampleCanvas" style="max-width: 100%; border-radius: 8px; border: 1px solid var(--accent); box-shadow: var(--shadow-md);"></canvas>
          <p id="frameStatusText" style="font-size: 0.8rem; color: var(--success); margin-top: 0.5rem;"><i class="fa-solid fa-circle-check"></i> Sampled video frame at 20% duration</p>
        </div>
      </div>
    `;

    const existingFrame = modalTechSpecsGrid.parentElement.querySelector('.modal-section:last-child');
    if (existingFrame && existingFrame.querySelector('#captureFrameBtn')) {
      existingFrame.remove();
    }
    modalTechSpecsGrid.parentElement.appendChild(frameSection);

    // Option 3 Capture Event Handler
    const captureFrameBtn = frameSection.querySelector('#captureFrameBtn');
    const framePreviewContainer = frameSection.querySelector('#framePreviewContainer');
    const sampleVideo = frameSection.querySelector('#sampleVideo');
    const sampleCanvas = frameSection.querySelector('#sampleCanvas');

    captureFrameBtn.addEventListener('click', () => {
      if (!record.file) {
        alert('File handle not available for live frame capture.');
        return;
      }
      captureFrameBtn.disabled = true;
      captureFrameBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-accent"></i> Seeking video frame...`;

      const videoUrl = URL.createObjectURL(record.file);
      sampleVideo.src = videoUrl;
      sampleVideo.muted = true;

      sampleVideo.onloadedmetadata = () => {
        sampleVideo.currentTime = sampleVideo.duration ? sampleVideo.duration * 0.20 : 300;
      };

      sampleVideo.onseeked = () => {
        sampleCanvas.width = sampleVideo.videoWidth || 640;
        sampleCanvas.height = sampleVideo.videoHeight || 360;
        const ctx = sampleCanvas.getContext('2d');
        ctx.drawImage(sampleVideo, 0, 0, sampleCanvas.width, sampleCanvas.height);

        framePreviewContainer.classList.remove('hidden');
        captureFrameBtn.disabled = false;
        captureFrameBtn.innerHTML = `<i class="fa-solid fa-camera text-accent"></i> Capture Another Frame (40%)`;

        URL.revokeObjectURL(videoUrl);
      };

      sampleVideo.onerror = () => {
        alert('Unable to load video codec in browser for frame preview.');
        captureFrameBtn.disabled = false;
        captureFrameBtn.innerHTML = `<i class="fa-solid fa-play text-accent"></i> Retry Frame Capture`;
      };
    });

    modalBackdrop.classList.remove('hidden');
  }

  function closeModal() {
    modalBackdrop.classList.add('hidden');
  }

  closeModalBtn.addEventListener('click', closeModal);
  modalCloseFooterBtn.addEventListener('click', closeModal);
  modalBackdrop.addEventListener('click', (e) => {
    if (e.target === modalBackdrop) closeModal();
  });

  // --- EXPORT DROPDOWN & REPORTS ---
  exportDropdownBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    exportMenu.classList.toggle('show');
  });

  document.addEventListener('click', () => {
    exportMenu.classList.remove('show');
  });

  exportCsvBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (scannedRecords.length === 0) return;

    let csvContent = 'File Name,Relative Path,Subtitle Status,Subtitle Count,Languages,Formats,Size\n';
    scannedRecords.forEach(r => {
      const subs = r.analysis ? r.analysis.subtitles : [];
      const langs = r.subStatus === 'has-subs' ? (subs.length > 0 ? [...new Set(subs.map(s => s.language))].join('; ') : (r.sidecarSubs.length > 0 ? r.sidecarSubs.join('; ') : 'Built-in Subtitles')) : 'None';

      csvContent += `"${r.fileName}","${r.filePath}","${r.subStatus.toUpperCase()}",${subs.length},"${langs}","${r.fileSizeFormatted}"\n`;
    });

    downloadBlob(csvContent, 'SubDetect_Report.csv', 'text/csv;charset=utf-8;');
  });

  exportJsonBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (scannedRecords.length === 0) return;

    const data = scannedRecords.map(r => ({
      fileName: r.fileName,
      filePath: r.filePath,
      fileSize: r.fileSizeFormatted,
      subStatus: r.subStatus,
      sidecarSubs: r.sidecarSubs || [],
      softSubtitles: r.analysis ? r.analysis.subtitles : []
    }));

    downloadBlob(JSON.stringify(data, null, 2), 'SubDetect_Report.json', 'application/json');
  });

  // --- CUSTOM TARGET FOLDER ORGANIZER MODAL ---
  const openOrganizeModalBtn = document.getElementById('openOrganizeModalBtn');
  const organizeModalBackdrop = document.getElementById('organizeModalBackdrop');
  const closeOrganizeModalBtn = document.getElementById('closeOrganizeModalBtn');
  const cancelOrganizeBtn = document.getElementById('cancelOrganizeBtn');
  const downloadOrganizeScriptBtn = document.getElementById('downloadOrganizeScriptBtn');

  const radioCardHasSubs = document.getElementById('radioCardHasSubs');
  const radioCardNoSubs = document.getElementById('radioCardNoSubs');
  const destFolderPath = document.getElementById('destFolderPath');
  const modalCountHasSubs = document.getElementById('modalCountHasSubs');
  const modalCountNoSubs = document.getElementById('modalCountNoSubs');

  function openOrganizeModal() {
    const subtitled = scannedRecords.filter(r => r.subStatus === 'has-subs');
    const nosubs = scannedRecords.filter(r => r.subStatus === 'no-subs');

    if (modalCountHasSubs) modalCountHasSubs.textContent = subtitled.length;
    if (modalCountNoSubs) modalCountNoSubs.textContent = nosubs.length;

    organizeModalBackdrop.classList.remove('hidden');
  }

  function closeOrganizeModal() {
    organizeModalBackdrop.classList.add('hidden');
  }

  if (openOrganizeModalBtn) {
    openOrganizeModalBtn.addEventListener('click', (e) => {
      e.preventDefault();
      if (scannedRecords.length === 0) {
        alert('Please scan or drop a movie folder first before organizing.');
        return;
      }
      openOrganizeModal();
    });
  }

  if (closeOrganizeModalBtn) closeOrganizeModalBtn.addEventListener('click', closeOrganizeModal);
  if (cancelOrganizeBtn) cancelOrganizeBtn.addEventListener('click', closeOrganizeModal);

  if (radioCardHasSubs && radioCardNoSubs) {
    radioCardHasSubs.addEventListener('click', () => {
      radioCardHasSubs.classList.add('active');
      radioCardNoSubs.classList.remove('active');
      const radio = radioCardHasSubs.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
      if (destFolderPath && destFolderPath.value === 'No_Subtitle_Movies') {
        destFolderPath.value = 'Subtitled_Movies';
      }
    });

    radioCardNoSubs.addEventListener('click', () => {
      radioCardNoSubs.classList.add('active');
      radioCardHasSubs.classList.remove('active');
      const radio = radioCardNoSubs.querySelector('input[type="radio"]');
      if (radio) radio.checked = true;
      if (destFolderPath && destFolderPath.value === 'Subtitled_Movies') {
        destFolderPath.value = 'No_Subtitle_Movies';
      }
    });
  }

  if (downloadOrganizeScriptBtn) {
    downloadOrganizeScriptBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      
      const selectedCategoryRadio = document.querySelector('input[name="organizeCategory"]:checked');
      const category = selectedCategoryRadio ? selectedCategoryRadio.value : 'has-subs';

      const selectedActionRadio = document.querySelector('input[name="organizeAction"]:checked');
      const action = selectedActionRadio ? selectedActionRadio.value : 'move';

      let targetFolder = (destFolderPath ? destFolderPath.value.trim() : '') || (category === 'has-subs' ? 'Subtitled_Movies' : 'No_Subtitle_Movies');

      const targetRecords = scannedRecords.filter(r => r.subStatus === category);
      if (targetRecords.length === 0) {
        const categoryName = category === 'has-subs' ? 'Movies with Built-in Subtitles' : 'Movies with No Subtitles';
        alert(`No files found in category: "${categoryName}".`);
        return;
      }

      downloadOrganizeScriptBtn.disabled = true;
      downloadOrganizeScriptBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Processing...`;

      // Direct Browser File System Access API Execution (If root directory handle exists)
      const rootDirHandle = window.mediaScanner ? window.mediaScanner.rootDirectoryHandle : null;
      let directMovedCount = 0;

      if (rootDirHandle && typeof rootDirHandle.getDirectoryHandle === 'function') {
        try {
          const targetDirHandle = await rootDirHandle.getDirectoryHandle(targetFolder, { create: true });
          for (const record of targetRecords) {
            if (record.file && record.file.fileHandle) {
              const srcHandle = record.file.fileHandle;
              const newFileHandle = await targetDirHandle.getFileHandle(record.fileName, { create: true });
              const writable = await newFileHandle.createWritable();
              await writable.write(await srcHandle.getFile());
              await writable.close();
              if (action === 'move' && record.file.parentDirHandle) {
                try {
                  await record.file.parentDirHandle.removeEntry(record.fileName);
                } catch (err) {}
              }
              directMovedCount++;
            }
          }
        } catch (err) {
          console.warn('Direct browser file move notice:', err);
        }
      }

      const categoryLabel = category === 'has-subs' ? 'Movies with Built-in Subtitles' : 'Movies with No Subtitles';
      const cmdName = action === 'move' ? 'Move-Item' : 'Copy-Item';
      const actionTitle = action === 'move' ? 'MOVE' : 'COPY';

      const isAbsolutePath = /^[a-zA-Z]:[\\\/]/.test(targetFolder);
      const safeFolder = targetFolder.replace(/"/g, '`"').replace(/\//g, '\\');

      let script = `# PowerShell Script: Custom Target Folder Organizer\n`;
      script += `# Category: ${categoryLabel} (${targetRecords.length} files)\n`;
      script += `# Target Destination Folder: ${safeFolder}\n`;
      script += `# Operation: ${actionTitle}\n\n`;

      script += `$dest = "${safeFolder}"\n`;
      script += `if (!(Test-Path -Path $dest)) { New-Item -ItemType Directory -Force -Path $dest | Out-Null }\n\n`;

      script += `$files = @(\n`;
      targetRecords.forEach((r, idx) => {
        const comma = idx === targetRecords.length - 1 ? '' : ',';
        const escPath = r.filePath.replace(/"/g, '`"');
        script += `    "${escPath}"${comma}\n`;
      });
      script += `)\n\n`;

      script += `foreach ($f in $files) {\n`;
      script += `    $cleanPath = $f.Replace('/', '\\')\n`;
      script += `    $leaf = Split-Path -Leaf $cleanPath\n`;
      script += `    if (Test-Path -Path $cleanPath) {\n`;
      script += `        ${cmdName} -Path $cleanPath -Destination $dest -Force\n`;
      script += `        Write-Host "${actionTitle}D: $cleanPath" -ForegroundColor Green\n`;
      script += `    } elseif (Test-Path -Path ".\\$cleanPath") {\n`;
      script += `        ${cmdName} -Path ".\\$cleanPath" -Destination $dest -Force\n`;
      script += `        Write-Host "${actionTitle}D: .\\$cleanPath" -ForegroundColor Green\n`;
      script += `    } else {\n`;
      script += `        $found = Get-ChildItem -Path $PSScriptRoot, "$env:USERPROFILE\\Downloads", "$env:USERPROFILE" -Filter $leaf -Recurse -File -ErrorAction SilentlyContinue | Select-Object -First 1\n`;
      script += `        if ($found) {\n`;
      script += `            ${cmdName} -Path $found.FullName -Destination $dest -Force\n`;
      script += `            Write-Host "${actionTitle}D: $($found.FullName)" -ForegroundColor Green\n`;
      script += `        } else {\n`;
      script += `            Write-Host "File not found: $leaf" -ForegroundColor Yellow\n`;
      script += `        }\n`;
      script += `    }\n`;
      script += `}\n\n`;
      script += `Write-Host "Organizing Complete!" -ForegroundColor Cyan\n`;

      const fileNameCategory = category === 'has-subs' ? 'Subtitled_Movies' : 'No_Subtitle_Movies';
      downloadBlob(script, `Organize_${fileNameCategory}_${action}.ps1`, 'text/plain;charset=utf-8;');

      downloadOrganizeScriptBtn.disabled = false;
      downloadOrganizeScriptBtn.innerHTML = `<i class="fa-solid fa-circle-check"></i> Done`;

      if (directMovedCount > 0) {
        alert(`Done! ${directMovedCount} files organized directly in browser.`);
      } else {
        alert(`Done! Organizing script downloaded. Right-click the downloaded .ps1 file and select 'Run with PowerShell' to complete moving your movies.`);
      }

      closeOrganizeModal();
    });
  }

  function downloadBlob(content, filename, contentType) {
    const blob = new Blob([content], { type: contentType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
});
