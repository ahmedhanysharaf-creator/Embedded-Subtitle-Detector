/**
 * SubDetect Main Application Controller & UI Store
 * Honest Embedded Subtitle Inspector & Optional User Hardsub Tagging
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
  const statNoSubCount = document.getElementById('statNoSubCount');
  const statCoveragePct = document.getElementById('statCoveragePct');

  // Toolbar & Filters
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const filterChips = document.querySelectorAll('.filter-chip');
  const countAll = document.getElementById('countAll');
  const countHasSubs = document.getElementById('countHasSubs');
  const countNoSubs = document.getElementById('countNoSubs');
  const countHardSubs = document.getElementById('countHardSubs');

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
    const files = await window.mediaScanner.pickDirectory();
    if (files && files.length > 0) {
      startScanning(files);
    } else {
      folderInput.click();
    }
  });

  selectFilesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.click();
  });

  folderInput.addEventListener('change', (e) => {
    const files = window.mediaScanner.processFileList(e.target.files);
    if (files.length > 0) startScanning(files);
  });

  fileInput.addEventListener('change', (e) => {
    const files = window.mediaScanner.processFileList(e.target.files);
    if (files.length > 0) startScanning(files);
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
      const files = await window.mediaScanner.processDataTransferItems(dt.items);
      if (files.length > 0) startScanning(files);
    } else if (dt.files && dt.files.length > 0) {
      const files = window.mediaScanner.processFileList(dt.files);
      if (files.length > 0) startScanning(files);
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
  async function startScanning(files) {
    scannedRecords = [];
    dropzoneSection.classList.add('hidden');
    progressSection.classList.remove('hidden');
    dashboardSection.classList.add('hidden');

    progressBarFill.style.width = '0%';
    progressPercent.textContent = '0%';
    progressSubtext.textContent = `Processing 0 of ${files.length} video files`;

    await window.mediaScanner.scanBatch(
      files,
      (prog) => {
        progressBarFill.style.width = `${prog.percent}%`;
        progressPercent.textContent = `${prog.percent}%`;
        progressSubtext.textContent = `Scanning file ${prog.currentIndex} of ${prog.totalFiles}`;
        currentScanningFile.textContent = prog.currentFileName;
      },
      (record) => {
        const subs = record.analysis ? record.analysis.subtitles : [];
        if (subs && subs.length > 0) {
          record.subStatus = 'soft-subs';
        } else {
          // Check if filename explicitly mentions hardsub / aradub
          const fName = record.fileName.toLowerCase();
          if (fName.includes('hardsub') || fName.includes('aradub') || fName.includes('subbed')) {
            record.subStatus = 'hard-subs';
          } else {
            record.subStatus = 'no-subs';
          }
        }
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
    const softsubs = scannedRecords.filter(r => r.subStatus === 'soft-subs');
    const hardsubs = scannedRecords.filter(r => r.subStatus === 'hard-subs');
    const nosubs = scannedRecords.filter(r => r.subStatus === 'no-subs');

    const subtitledCount = softsubs.length; // Only genuine soft embedded tracks count towards embedded subs ratio
    const pct = total > 0 ? Math.round((subtitledCount / total) * 100) : 0;

    if (statTotalFiles) statTotalFiles.textContent = total;
    if (statSubtitledCount) statSubtitledCount.textContent = subtitledCount;
    if (statNoSubCount) statNoSubCount.textContent = nosubs.length;
    if (statCoveragePct) statCoveragePct.textContent = `${pct}%`;

    if (countAll) countAll.textContent = total;
    if (countHasSubs) countHasSubs.textContent = subtitledCount;
    if (countNoSubs) countNoSubs.textContent = nosubs.length;
    if (countHardSubs) countHardSubs.textContent = hardsubs.length;

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
      if (currentFilter === 'has-subs' && record.subStatus !== 'soft-subs') return false;
      if (currentFilter === 'no-subs' && record.subStatus !== 'no-subs') return false;
      if (currentFilter === 'hard-subs' && record.subStatus !== 'hard-subs') return false;

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

      if (record.subStatus === 'soft-subs') {
        statusBadge = `<div class="sub-status-badge sub-badge-has"><i class="fa-solid fa-closed-captioning"></i> ${subs.length} Embedded Subtitle Track${subs.length > 1 ? 's' : ''}</div>`;
        const langs = [...new Set(subs.map(s => s.language || 'und'))].slice(0, 4);
        const formats = [...new Set(subs.map(s => s.format))].slice(0, 3);
        trackChipsHtml += langs.map(l => `<span class="track-chip track-chip-lang"><i class="fa-solid fa-globe"></i> ${l.toUpperCase()}</span>`).join('');
        trackChipsHtml += formats.map(f => `<span class="track-chip"><i class="fa-solid fa-file-lines"></i> ${f}</span>`).join('');
      } else if (record.subStatus === 'hard-subs') {
        statusBadge = `<div class="sub-status-badge sub-badge-hard" style="background: rgba(245,158,11,0.15); color: var(--warning); border: 1px solid rgba(245,158,11,0.3);"><i class="fa-solid fa-tag"></i> Tagged: Hardcoded Subtitles</div>`;
        trackChipsHtml = `<span class="track-chip track-chip-lang" style="background: rgba(245,158,11,0.2); color: var(--warning);"><i class="fa-solid fa-eye"></i> BURNED-IN SUBTITLES</span>`;
      } else {
        statusBadge = `<div class="sub-status-badge sub-badge-none"><i class="fa-solid fa-circle-xmark"></i> No Embedded Subtitles</div>`;
      }

      card.innerHTML = `
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
            ${record.subStatus !== 'soft-subs' ? `
              <button class="btn btn-outline btn-sm tag-btn" data-id="${record.id}" title="Toggle Hardsub Tag">
                <i class="fa-solid fa-tag"></i> ${record.subStatus === 'hard-subs' ? 'Untag' : 'Tag Hardsub'}
              </button>
            ` : ''}
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
          record.subStatus = (record.subStatus === 'hard-subs') ? 'no-subs' : 'hard-subs';
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
      if (record.subStatus === 'soft-subs') {
        statusHtml = `<span class="text-success" style="font-weight: 600;"><i class="fa-solid fa-circle-check"></i> ${subs.length} Subtitle Track(s)</span>`;
      } else if (record.subStatus === 'hard-subs') {
        statusHtml = `<span class="text-warning" style="font-weight: 600;"><i class="fa-solid fa-tag"></i> Tagged Hardsub</span>`;
      } else {
        statusHtml = `<span class="text-danger" style="font-weight: 500;"><i class="fa-solid fa-circle-xmark"></i> None</span>`;
      }

      const langs = record.subStatus === 'soft-subs' ? [...new Set(subs.map(s => s.language || 'und'))].join(', ') : '—';
      const formats = record.subStatus === 'soft-subs' ? [...new Set(subs.map(s => s.format))].join(', ') : '—';

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
          <button class="btn btn-outline btn-sm inspect-btn" data-id="${record.id}">
            <i class="fa-solid fa-sliders"></i> Details
          </button>
        </td>
      `;

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
      <span class="track-chip track-chip-lang"><i class="fa-solid fa-layer-group"></i> ${subs.length} Subtitle Track${subs.length !== 1 ? 's' : ''}</span>
      <span class="track-chip"><i class="fa-solid fa-microchip"></i> ${analysis.parsedBy || 'MediaInfo WASM'}</span>
    `;

    // Subtitle Tracks List
    if (subs.length === 0) {
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

    let csvContent = 'File Name,Relative Path,Has Subtitles,Subtitle Count,Languages,Formats,Size\n';
    scannedRecords.forEach(r => {
      const hasSubs = r.subStatus === 'soft-subs';
      const subs = r.analysis ? r.analysis.subtitles : [];
      const langs = hasSubs ? [...new Set(subs.map(s => s.language))].join('; ') : (r.subStatus === 'hard-subs' ? 'Tagged Hardsub' : 'None');
      const formats = hasSubs ? [...new Set(subs.map(s => s.format))].join('; ') : (r.subStatus === 'hard-subs' ? 'Hardsub' : 'None');

      csvContent += `"${r.fileName}","${r.filePath}","${hasSubs ? 'YES' : 'NO'}",${subs.length},"${langs}","${formats}","${r.fileSizeFormatted}"\n`;
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
      hasEmbeddedSubtitles: r.subStatus === 'soft-subs',
      isTaggedHardsub: r.subStatus === 'hard-subs',
      softSubtitles: r.analysis ? r.analysis.subtitles : []
    }));

    downloadBlob(JSON.stringify(data, null, 2), 'SubDetect_Report.json', 'application/json');
  });

  copyMissingSubsBtn.addEventListener('click', (e) => {
    e.preventDefault();
    const missing = scannedRecords
      .filter(r => r.subStatus === 'no-subs')
      .map(r => r.fileName);

    if (missing.length === 0) {
      alert('All scanned videos have subtitles!');
      return;
    }

    navigator.clipboard.writeText(missing.join('\n')).then(() => {
      alert(`Copied ${missing.length} video filenames missing subtitles to clipboard!`);
    }).catch(err => {
      console.warn('Clipboard write error:', err);
    });
  });

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
