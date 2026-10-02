/**
 * ==========================================================================
 * AUTO MEASUREMENT FOR SEM EDX - INTERACTIVE ENGINE
 * Focus: 100% AUTOMATED MEASUREMENT SIMULATOR (ĐO TỰ ĐỘNG LÀ TRỌNG TÂM)
 * Quy trình:
 * 1. Ban đầu: Chưa có vạch đo, chưa có điểm bắt, chưa có kết quả (Ảnh thô).
 * 2. Khi ấn "BẤM ĐO TỰ ĐỘNG": Quét laser, bắt 4 điểm P1-P4, vẽ 2 vạch đo
 *    mũi tên màu đỏ và tính toán xuất kết quả Top, Bot, %Taper.
 * 3. Đo thủ công: Là tính năng phụ trợ kiểm tra khi cần.
 * ==========================================================================
 */

document.addEventListener('DOMContentLoaded', () => {
  initMetrologySimulator();
  initImageLightbox();
  initCopyCodeButtons();
  initNavScrollSpy();
});

/* ==========================================================================
   1. METROLOGY SIMULATOR (AUTO MEASUREMENT ENGINE AS PRIMARY)
   ========================================================================== */

function initMetrologySimulator() {
  const canvas = document.getElementById('metrologyCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  // DOM Elements - Modes & Buttons
  const tabModeAuto = document.getElementById('tabModeAuto');
  const tabModeManual = document.getElementById('tabModeManual');
  const btnTriggerAutoScan = document.getElementById('btnTriggerAutoScan');
  const btnResetCanvas = document.getElementById('btnResetCanvas');

  // Sliders & Controls
  const sliderThresh = document.getElementById('sliderThresh');
  const threshValBadge = document.getElementById('threshValBadge');
  const sliderRatio = document.getElementById('sliderRatio');
  const ratioValBadge = document.getElementById('ratioValBadge');
  const chkAutoCorrect = document.getElementById('chkAutoCorrect');

  // Readout elements
  const valTopPx = document.getElementById('valTopPx');
  const valTopUm = document.getElementById('valTopUm');
  const valBotPx = document.getElementById('valBotPx');
  const valBotUm = document.getElementById('valBotUm');
  const valTaper = document.getElementById('valTaper');
  const valTiltTop = document.getElementById('valTiltTop');
  const valTiltBot = document.getElementById('valTiltBot');
  const statusPill = document.getElementById('statusPill');
  const autoTelemetry = document.getElementById('autoTelemetry');
  const manualStepBanner = document.getElementById('manualStepBanner');

  // Step timeline badges
  const stepBadges = [
    document.getElementById('stepBinarize'),
    document.getElementById('stepSubstrate'),
    document.getElementById('stepLayer1'),
    document.getElementById('stepLayer2'),
    document.getElementById('stepResult')
  ];

  // Preset buttons
  const presetBtns = document.querySelectorAll('.preset-btn');

  // Simulator State
  let state = {
    mode: 'auto', // 'auto' (primary) or 'manual' (auxiliary)
    isMeasured: false, // BAN ĐẦU CHƯA ĐO: KHÔNG CÓ VẠCH ĐO, KHÔNG CÓ ĐIỂM
    isScanning: false,
    scanProgress: 0.0, // 0.0 to 1.0
    scanPhase: 0, // 0: Idle, 1: Scanline, 2: Substrate, 3: Catch Points, 4: Align Y, 5: Complete

    // Physical Wall Geometry (Mô phỏng mặt cắt vi cấu trúc)
    wallLeft: {
      topX: 190,
      topY: 155,
      botX: 195,
      botY: 240
    },
    wallRight: {
      topX: 490,
      topY: 150,
      botX: 485,
      botY: 245
    },

    // Detected Points (Auto-detected by 3-Layer CV)
    autoPoints: {
      p1: { x: 190, y: 155, name: 'P1 (TL)' },
      p2: { x: 490, y: 150, name: 'P2 (TR)' },
      p3: { x: 195, y: 240, name: 'P3 (BL)' },
      p4: { x: 485, y: 245, name: 'P4 (BR)' }
    },

    // Manual Clicks (Auxiliary mode fallback)
    manualPoints: [],

    ratioNm: 158.75, // nm per pixel
    threshold: 120,
    autoCorrect: true, // Layer 3 Y-Balance
    executionTimeMs: 12.4, // Benchmark in ms
    draggedHandle: null,
    hoveredHandle: null
  };

  const HANDLE_RADIUS = 9;

  // Preset Configurations
  const presets = {
    standard: {
      wallLeft: { topX: 190, topY: 155, botX: 195, botY: 240 },
      wallRight: { topX: 490, topY: 150, botX: 485, botY: 245 },
      name: "Tiêu chuẩn (Standard)"
    },
    hightaper: {
      wallLeft: { topX: 170, topY: 150, botX: 230, botY: 245 },
      wallRight: { topX: 510, topY: 150, botX: 450, botY: 245 },
      name: "Độ vát cao (High Taper)"
    },
    fractured: {
      wallLeft: { topX: 190, topY: 160, botX: 185, botY: 245 },
      wallRight: { topX: 490, topY: 155, botX: 480, botY: 240 },
      name: "Vách đứt đoạn răng cưa"
    }
  };

  // High-DPI Canvas Scaling
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    render();
  }

  // AUTOMATED 3-LAYER COMPUTER VISION SIMULATION ENGINE
  function runAutoAlgorithm() {
    let p1 = { x: state.wallLeft.topX, y: state.wallLeft.topY, name: 'P1 (TL)' };
    let p3 = { x: state.wallLeft.botX, y: state.wallLeft.botY, name: 'P3 (BL)' };
    let p2 = { x: state.wallRight.topX, y: state.wallRight.topY, name: 'P2 (TR)' };
    let p4 = { x: state.wallRight.botX, y: state.wallRight.botY, name: 'P4 (BR)' };

    // Substrate purge safety constraint: No bottom point can cross 75% H
    const rect = canvas.getBoundingClientRect();
    const maxAllowedY = rect.height * 0.74;
    p3.y = Math.min(p3.y, maxAllowedY);
    p4.y = Math.min(p4.y, maxAllowedY);

    let isLayer3Active = false;

    // Layer 3 Co-planar Y-Balance & 35 deg Angle Lock
    if (state.autoCorrect) {
      // Top angle
      const dX_top = Math.abs(p2.x - p1.x);
      const dY_top = Math.abs(p2.y - p1.y);
      const angleTop = Math.atan2(dY_top, dX_top) * (180 / Math.PI);

      if (angleTop > 35.0 || dY_top > 40) {
        const targetY = Math.min(p1.y, p2.y);
        p1.y = targetY;
        p2.y = targetY;
        isLayer3Active = true;
      }

      // Bottom angle
      const dX_bot = Math.abs(p4.x - p3.x);
      const dY_bot = Math.abs(p4.y - p3.y);
      const angleBot = Math.atan2(dY_bot, dX_bot) * (180 / Math.PI);

      if (angleBot > 35.0 || dY_bot > 40) {
        const targetY = Math.min(p3.y, p4.y);
        p3.y = targetY;
        p4.y = targetY;
        isLayer3Active = true;
      }
    }

    state.autoPoints = { p1, p2, p3, p4 };
    return { p1, p2, p3, p4, isLayer3Active };
  }

  // MATHEMATICAL METROLOGY READOUTS
  function computeAndDisplayMetrology() {
    // TRƯỜNG HỢP 1: Chế độ tự động nhưng CHƯA BẤM ĐO TỰ ĐỘNG
    if (state.mode === 'auto' && !state.isMeasured) {
      if (valTopPx) valTopPx.textContent = '-- px';
      if (valTopUm) valTopUm.textContent = '-- µm';
      if (valBotPx) valBotPx.textContent = '-- px';
      if (valBotUm) valBotUm.textContent = '-- µm';
      if (valTaper) valTaper.textContent = '-- %';
      if (valTiltTop) valTiltTop.textContent = '--°';
      if (valTiltBot) valTiltBot.textContent = '--°';

      if (statusPill) {
        statusPill.className = 'validation-pill warning';
        statusPill.innerHTML = `ẢNH GỐC CHƯA ĐO: Bấm nút "BẤM ĐO TỰ ĐỘNG" để bắt 4 điểm và vẽ kết quả.`;
      }

      if (autoTelemetry) {
        autoTelemetry.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:center; gap:8px;">
            <span class="live-pulse-dot" style="background:#f59e0b;"></span>
            <strong>CHỜ LỆNH:</strong> Chưa có vạch đo. Hãy bấm <strong>BẤM ĐO TỰ ĐỘNG (AUTO SCAN)</strong> để khởi chạy.
          </div>
        `;
      }
      return null;
    }

    let pt1, pt2, pt3, pt4;
    let isCorrected = false;

    if (state.mode === 'auto') {
      const res = runAutoAlgorithm();
      pt1 = res.p1;
      pt2 = res.p2;
      pt3 = res.p3;
      pt4 = res.p4;
      isCorrected = res.isLayer3Active;
    } else {
      // Manual Mode
      if (state.manualPoints.length === 4) {
        const sorted = [...state.manualPoints].sort((a, b) => a.y - b.y);
        const topPts = [sorted[0], sorted[1]].sort((a, b) => a.x - b.x);
        const botPts = [sorted[2], sorted[3]].sort((a, b) => a.x - b.x);
        pt1 = topPts[0];
        pt2 = topPts[1];
        pt3 = botPts[0];
        pt4 = botPts[1];
      } else {
        if (valTopPx) valTopPx.textContent = '-- px';
        if (valTopUm) valTopUm.textContent = '-- µm';
        if (valBotPx) valBotPx.textContent = '-- px';
        if (valBotUm) valBotUm.textContent = '-- µm';
        if (valTaper) valTaper.textContent = '-- %';
        if (statusPill) {
          statusPill.className = 'validation-pill warning';
          statusPill.innerHTML = `Đang chờ chấm thủ công: Đã chọn ${state.manualPoints.length}/4 điểm`;
        }
        return null;
      }
    }

    // Euclidean Distances (px)
    const distTopPx = Math.hypot(pt2.x - pt1.x, pt2.y - pt1.y);
    const distBotPx = Math.hypot(pt4.x - pt3.x, pt4.y - pt3.y);

    // Ratio nm -> µm
    const ratioUm = state.ratioNm / 1000.0;
    const topUm = distTopPx * ratioUm;
    const botUm = distBotPx * ratioUm;
    const taperPercent = topUm > 0 ? (botUm / topUm) * 100 : 0;

    // Angles
    const tiltTop = Math.atan2(Math.abs(pt2.y - pt1.y), Math.abs(pt2.x - pt1.x)) * (180 / Math.PI);
    const tiltBot = Math.atan2(Math.abs(pt4.y - pt3.y), Math.abs(pt4.x - pt3.x)) * (180 / Math.PI);

    // Update UI Badges
    if (valTopPx) valTopPx.textContent = `${distTopPx.toFixed(1)} px`;
    if (valTopUm) valTopUm.textContent = `${topUm.toFixed(3)} µm`;
    if (valBotPx) valBotPx.textContent = `${distBotPx.toFixed(1)} px`;
    if (valBotUm) valBotUm.textContent = `${botUm.toFixed(3)} µm`;
    if (valTaper) valTaper.textContent = `${taperPercent.toFixed(2)} %`;
    if (valTiltTop) valTiltTop.textContent = `${tiltTop.toFixed(1)}°`;
    if (valTiltBot) valTiltBot.textContent = `${tiltBot.toFixed(1)}°`;

    if (statusPill) {
      if (state.mode === 'auto') {
        if (isCorrected) {
          statusPill.className = 'validation-pill warning';
          statusPill.innerHTML = `Đo Tự Động Xong: Đã tự cân bằng Y & Khóa góc ≤ 35° (${state.executionTimeMs.toFixed(1)}ms)`;
        } else {
          statusPill.className = 'validation-pill valid';
          statusPill.innerHTML = `Đo Tự Động Hoàn Hảo: 4 Góc biên bắt chuẩn tuyệt đối (${state.executionTimeMs.toFixed(1)}ms)`;
        }
      } else {
        statusPill.className = 'validation-pill valid';
        statusPill.innerHTML = `Đo Thủ Công: Đã chấm đủ 4 điểm & Tính toán kích thước xong`;
      }
    }

    if (autoTelemetry) {
      if (state.mode === 'auto') {
        autoTelemetry.innerHTML = `
          <div style="display:flex; align-items:center; justify-content:center; gap:8px;">
            <span class="live-pulse-dot"></span>
            <strong>KẾT QUẢ ĐO TỰ ĐỘNG ĐÃ XUẤT</strong> | Tốc độ: <strong>${state.executionTimeMs.toFixed(1)} ms</strong> | 32 Threads Parallel | Trạng thái: PASS
          </div>
        `;
      }
    }

    return { pt1, pt2, pt3, pt4, topUm, botUm, taperPercent };
  }

  // DRAW DOUBLE ARROW DIMENSION LINE
  function drawDoubleArrow(ctx, pStart, pEnd, color = '#ef4444') {
    const headLen = 14;
    const angle = Math.atan2(pEnd.y - pStart.y, pEnd.x - pStart.x);

    ctx.save();
    // Outer black stroke for contrast (identical to _S.bmp)
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(pStart.x, pStart.y);
    ctx.lineTo(pEnd.x, pEnd.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pStart.x + headLen * Math.cos(angle + Math.PI / 6), pStart.y + headLen * Math.sin(angle + Math.PI / 6));
    ctx.lineTo(pStart.x, pStart.y);
    ctx.lineTo(pStart.x + headLen * Math.cos(angle - Math.PI / 6), pStart.y + headLen * Math.sin(angle - Math.PI / 6));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pEnd.x - headLen * Math.cos(angle - Math.PI / 6), pEnd.y - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(pEnd.x, pEnd.y);
    ctx.lineTo(pEnd.x - headLen * Math.cos(angle + Math.PI / 6), pEnd.y - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();

    // Inner bright colored stroke
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.moveTo(pStart.x, pStart.y);
    ctx.lineTo(pEnd.x, pEnd.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pStart.x + headLen * Math.cos(angle + Math.PI / 6), pStart.y + headLen * Math.sin(angle + Math.PI / 6));
    ctx.lineTo(pStart.x, pStart.y);
    ctx.lineTo(pStart.x + headLen * Math.cos(angle - Math.PI / 6), pStart.y + headLen * Math.sin(angle - Math.PI / 6));
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(pEnd.x - headLen * Math.cos(angle - Math.PI / 6), pEnd.y - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(pEnd.x, pEnd.y);
    ctx.lineTo(pEnd.x - headLen * Math.cos(angle + Math.PI / 6), pEnd.y - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();

    ctx.restore();
  }

  // MAIN RENDER LOOP
  function render() {
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    // 1. Engineering Graph Paper Grid
    ctx.save();
    ctx.strokeStyle = '#f1f5f9';
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    ctx.restore();

    // 2. 75% Y Substrate Cutoff Rule (Safety Zone)
    const cutoffY = height * 0.75;
    ctx.save();
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, cutoffY);
    ctx.lineTo(width, cutoffY);
    ctx.stroke();

    ctx.fillStyle = 'rgba(239, 68, 68, 0.05)';
    ctx.fillRect(0, cutoffY, width, height - cutoffY);

    ctx.font = 'bold 11px "Fira Code", monospace';
    ctx.fillStyle = '#dc2626';
    ctx.fillText('VÙNG CẮT BỎ CHÂN ĐẾ SUBSTRATE (Y ≥ 75%H): KHÓA 100% ĐO NHẦM ĐÁY', 14, cutoffY - 8);
    ctx.restore();

    // 3. Draw The Micro-Trench Solid Blocks (Left Wall & Right Wall)
    ctx.save();
    ctx.fillStyle = '#0f172a';

    // Left Wall
    ctx.beginPath();
    ctx.moveTo(0, state.wallLeft.topY);
    ctx.lineTo(state.wallLeft.topX, state.wallLeft.topY);
    ctx.lineTo(state.wallLeft.botX, state.wallLeft.botY);
    ctx.lineTo(0, state.wallLeft.botY);
    ctx.closePath();
    ctx.fill();

    // Right Wall
    ctx.beginPath();
    ctx.moveTo(state.wallRight.topX, state.wallRight.topY);
    ctx.lineTo(width, state.wallRight.topY);
    ctx.lineTo(width, state.wallRight.botY);
    ctx.lineTo(state.wallRight.botX, state.wallRight.botY);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 4. Sketch Crosshatch on Material Walls
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = 1.5;
    for (let lx = -100; lx < state.wallLeft.topX; lx += 14) {
      ctx.beginPath();
      ctx.moveTo(Math.max(0, lx), state.wallLeft.topY);
      ctx.lineTo(Math.min(state.wallLeft.topX, lx + 40), state.wallLeft.botY);
      ctx.stroke();
    }
    for (let rx = state.wallRight.topX; rx < width + 100; rx += 14) {
      ctx.beginPath();
      ctx.moveTo(rx, state.wallRight.topY);
      ctx.lineTo(rx + 40, state.wallRight.botY);
      ctx.stroke();
    }
    ctx.restore();

    // 5. Hand-Drawn Title "DEMO Image" on Top
    ctx.save();
    ctx.font = '28px "Architects Daughter", cursive, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'center';
    const trenchMidX = (state.wallLeft.topX + state.wallRight.topX) / 2;
    ctx.fillText('DEMO Image', trenchMidX, 60);

    // Mode Stamp
    if (state.mode === 'auto') {
      ctx.font = 'bold 12px "Fira Code", monospace';
      ctx.fillStyle = state.isMeasured ? '#059669' : '#d97706';
      const statusText = state.isMeasured 
        ? '[ KẾT QUẢ ĐO TỰ ĐỘNG - 4 ĐIỂM ĐÃ ĐƯỢC BẮT CHUẨN ]'
        : '[ ẢNH GỐC BAN ĐẦU - CHƯA BẮT ĐIỂM, CHƯA CÓ VẠCH ĐO ]';
      ctx.fillText(statusText, trenchMidX, 85);
    } else {
      ctx.font = 'bold 12px "Fira Code", monospace';
      ctx.fillStyle = '#0284c7';
      ctx.fillText('[ CHẾ ĐỘ PHỤ TRỢ: ĐO THỦ CÔNG & THẨM ĐỊNH ]', trenchMidX, 85);
    }
    ctx.restore();

    // 6. Draw Auto-Scan Laser Animation if Scanning
    if (state.isScanning) {
      const beamY = height * state.scanProgress;
      ctx.save();
      // Laser beam gradient
      const grad = ctx.createLinearGradient(0, beamY - 15, 0, beamY + 15);
      grad.addColorStop(0, 'rgba(239, 68, 68, 0)');
      grad.addColorStop(0.5, 'rgba(239, 68, 68, 0.85)');
      grad.addColorStop(1, 'rgba(239, 68, 68, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, beamY - 15, width, 30);

      // Bright laser line
      ctx.strokeStyle = '#ef4444';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(0, beamY);
      ctx.lineTo(width, beamY);
      ctx.stroke();

      // Laser Tag
      ctx.fillStyle = '#dc2626';
      ctx.font = 'bold 11px "Fira Code", monospace';
      ctx.fillText('CV SCANNING BEAM...', 16, beamY - 6);
      ctx.restore();

      // Show catching points during scan phase 3 & 4
      if (state.scanPhase >= 3) {
        const rawPts = [
          { x: state.wallLeft.topX, y: state.wallLeft.topY, name: 'P1' },
          { x: state.wallRight.topX, y: state.wallRight.topY, name: 'P2' },
          { x: state.wallLeft.botX, y: state.wallLeft.botY, name: 'P3' },
          { x: state.wallRight.botX, y: state.wallRight.botY, name: 'P4' }
        ];

        rawPts.forEach((pt, i) => {
          ctx.save();
          ctx.strokeStyle = '#ef4444';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 14 + Math.sin(Date.now() * 0.02) * 4, 0, Math.PI * 2);
          ctx.stroke();

          ctx.font = 'bold 11px "Fira Code", monospace';
          ctx.fillStyle = '#ef4444';
          ctx.fillText(`Đang bắt ${pt.name}...`, pt.x + 16, pt.y);
          ctx.restore();
        });
      }
    }

    // 7. IN AUTO MODE: IF NOT MEASURED AND NOT SCANNING -> DRAW CLEAN INITIAL PROMPT
    if (state.mode === 'auto' && !state.isMeasured && !state.isScanning) {
      ctx.save();
      // Clean sketch note in center
      ctx.fillStyle = 'rgba(254, 240, 138, 0.9)';
      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 2;
      const boxW = 340;
      const boxH = 75;
      const boxX = trenchMidX - boxW / 2;
      const boxY = 160;
      ctx.fillRect(boxX, boxY, boxW, boxH);
      ctx.strokeRect(boxX, boxY, boxW, boxH);

      ctx.font = 'bold 15px "Patrick Hand", cursive';
      ctx.fillStyle = '#0f172a';
      ctx.textAlign = 'center';
      ctx.fillText('Ban đầu chưa có vạch đo & chưa bắt điểm', trenchMidX, boxY + 28);

      ctx.font = '13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
      ctx.fillStyle = '#b91c1c';
      ctx.fillText('Ấn nút "BẤM ĐO TỰ ĐỘNG" để bắt 4 điểm & đo kết quả!', trenchMidX, boxY + 52);
      ctx.restore();
    }

    // 8. Render Measurement Output (Only if Measured in Auto Mode, or if Manual points complete)
    const metrics = computeAndDisplayMetrology();

    if (metrics && (state.isMeasured || state.mode === 'manual')) {
      const { pt1, pt2, pt3, pt4, topUm, botUm, taperPercent } = metrics;

      // Draw Dimension Arrows
      drawDoubleArrow(ctx, pt1, pt2, '#ef4444');
      drawDoubleArrow(ctx, pt3, pt4, '#ef4444');

      // Central Dimensions text
      ctx.save();
      ctx.font = 'bold 15px "Fira Code", monospace';
      ctx.textAlign = 'center';
      const textCenterY = (pt1.y + pt3.y) / 2;
      const lineSpacing = 22;

      const overlayLines = [
        { text: `Top: ${topUm.toFixed(3)} um`, color: '#ef4444' },
        { text: `Bot: ${botUm.toFixed(3)} um`, color: '#2563eb' },
        { text: `%Taper: ${taperPercent.toFixed(2)} %`, color: '#059669' }
      ];

      overlayLines.forEach((item, idx) => {
        const yPos = textCenterY - lineSpacing + idx * lineSpacing;
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#ffffff';
        ctx.strokeText(item.text, trenchMidX, yPos);
        ctx.fillStyle = item.color;
        ctx.fillText(item.text, trenchMidX, yPos);
      });
      ctx.restore();

      // In Auto mode, draw detected corner indicators
      if (state.mode === 'auto') {
        [pt1, pt2, pt3, pt4].forEach((pt, i) => {
          ctx.save();
          // Radar target circle
          ctx.strokeStyle = '#059669';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 10, 0, Math.PI * 2);
          ctx.stroke();

          // Crosshair
          ctx.beginPath();
          ctx.moveTo(pt.x - 14, pt.y);
          ctx.lineTo(pt.x + 14, pt.y);
          ctx.moveTo(pt.x, pt.y - 14);
          ctx.lineTo(pt.x, pt.y + 14);
          ctx.stroke();

          // Label
          ctx.font = 'bold 12px "Patrick Hand", cursive';
          ctx.fillStyle = '#065f46';
          ctx.fillText(`P${i+1} [ĐÃ BẮT]`, pt.x + 12, pt.y - 10);
          ctx.restore();
        });
      }
    }

    // In Manual Mode, draw manual click markers
    if (state.mode === 'manual') {
      state.manualPoints.forEach((pt, i) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#0284c7';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.fill();
        ctx.stroke();

        ctx.font = 'bold 12px "Fira Code", monospace';
        ctx.fillStyle = '#0f172a';
        ctx.fillText(`P${i+1}`, pt.x + 10, pt.y - 10);
        ctx.restore();
      });
    }

    // Draw Interactive Drag Handles for Wall Adjustments (Simulating testing different samples)
    if (state.mode === 'auto') {
      const handles = [
        { x: state.wallLeft.topX, y: state.wallLeft.topY, id: 'leftTop', label: 'Chỉnh vách trái' },
        { x: state.wallLeft.botX, y: state.wallLeft.botY, id: 'leftBot', label: '' },
        { x: state.wallRight.topX, y: state.wallRight.topY, id: 'rightTop', label: 'Chỉnh vách phải' },
        { x: state.wallRight.botX, y: state.wallRight.botY, id: 'rightBot', label: '' }
      ];

      handles.forEach(h => {
        const isHover = state.hoveredHandle === h.id;
        const isDrag = state.draggedHandle === h.id;
        ctx.save();
        ctx.beginPath();
        ctx.arc(h.x, h.y, HANDLE_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = isDrag ? '#f59e0b' : (isHover ? '#38bdf8' : '#ffffff');
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 2;
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 4;
        ctx.fill();
        ctx.stroke();

        if (h.label) {
          ctx.font = '11px "Patrick Hand", cursive';
          ctx.fillStyle = '#64748b';
          ctx.fillText(h.label, h.x, h.y - 12);
        }
        ctx.restore();
      });
    }
  }

  // AUTO SCAN SIMULATION TRIGGER (ANIMATION PIPELINE)
  function triggerAutoScanAnimation() {
    if (state.isScanning) return;
    state.isScanning = true;
    state.isMeasured = false; // Reset to unmeasured during the scan
    state.scanProgress = 0.0;
    state.scanPhase = 1;

    // Reset badges
    stepBadges.forEach(b => { if (b) b.className = 'timeline-step-badge'; });

    const startTime = performance.now();

    function stepScan() {
      state.scanProgress += 0.022;

      // Update Phase Badges
      if (state.scanProgress < 0.25) {
        state.scanPhase = 1; // Binarization
        if (stepBadges[0]) stepBadges[0].className = 'timeline-step-badge active';
      } else if (state.scanProgress < 0.5) {
        state.scanPhase = 2; // Substrate purge
        if (stepBadges[0]) stepBadges[0].className = 'timeline-step-badge done';
        if (stepBadges[1]) stepBadges[1].className = 'timeline-step-badge active';
      } else if (state.scanProgress < 0.75) {
        state.scanPhase = 3; // Layer 1 & 2: Catch Points
        if (stepBadges[1]) stepBadges[1].className = 'timeline-step-badge done';
        if (stepBadges[2]) stepBadges[2].className = 'timeline-step-badge active';
        if (stepBadges[3]) stepBadges[3].className = 'timeline-step-badge active';
      } else if (state.scanProgress < 1.0) {
        state.scanPhase = 4; // Layer 3: Align Y
        if (stepBadges[2]) stepBadges[2].className = 'timeline-step-badge done';
        if (stepBadges[3]) stepBadges[3].className = 'timeline-step-badge done';
        if (stepBadges[4]) stepBadges[4].className = 'timeline-step-badge active';
      }

      render();

      if (state.scanProgress < 1.0) {
        requestAnimationFrame(stepScan);
      } else {
        // FINISHED! CATCH POINTS, DRAW MEASUREMENT ARROWS AND DISPLAY RESULTS
        state.isScanning = false;
        state.isMeasured = true; // BÂY GIỜ MỚI HIỂN THỊ VẠCH ĐO VÀ ĐƯA RA KẾT QUẢ!
        state.scanProgress = 1.0;
        state.scanPhase = 5;
        state.executionTimeMs = Math.round((performance.now() - startTime) * 0.15 * 10) / 10;
        stepBadges.forEach(b => { if (b) b.className = 'timeline-step-badge done'; });
        
        if (btnTriggerAutoScan) {
          btnTriggerAutoScan.innerHTML = 'ĐO LẠI (RE-SCAN)';
        }
        render();
      }
    }

    requestAnimationFrame(stepScan);
  }

  // EVENT LISTENERS & MODE SWITCHING
  if (tabModeAuto) {
    tabModeAuto.addEventListener('click', () => {
      state.mode = 'auto';
      tabModeAuto.className = 'mode-tab-btn active primary-mode';
      if (tabModeManual) tabModeManual.className = 'mode-tab-btn';
      if (manualStepBanner) manualStepBanner.style.display = 'none';
      render();
    });
  }

  if (tabModeManual) {
    tabModeManual.addEventListener('click', () => {
      state.mode = 'manual';
      state.manualPoints = [];
      tabModeManual.className = 'mode-tab-btn active aux-mode';
      if (tabModeAuto) tabModeAuto.className = 'mode-tab-btn';
      if (manualStepBanner) {
        manualStepBanner.style.display = 'block';
        manualStepBanner.textContent = 'BƯỚC 1 (Chế độ phụ): Click chuột vào ảnh để chọn Điểm P1 (Đỉnh mép trái)';
      }
      render();
    });
  }

  if (btnTriggerAutoScan) {
    btnTriggerAutoScan.addEventListener('click', () => {
      if (state.mode !== 'auto') {
        if (tabModeAuto) tabModeAuto.click();
      }
      triggerAutoScanAnimation();
    });
  }

  // Mouse drag handles on canvas in Auto mode
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    if (state.mode === 'auto') {
      const handles = [
        { x: state.wallLeft.topX, y: state.wallLeft.topY, id: 'leftTop' },
        { x: state.wallLeft.botX, y: state.wallLeft.botY, id: 'leftBot' },
        { x: state.wallRight.topX, y: state.wallRight.topY, id: 'rightTop' },
        { x: state.wallRight.botX, y: state.wallRight.botY, id: 'rightBot' }
      ];

      for (let h of handles) {
        if (Math.hypot(h.x - cx, h.y - cy) <= HANDLE_RADIUS + 6) {
          state.draggedHandle = h.id;
          // When changing wall shape, reset measurement so user can hit auto measure again
          state.isMeasured = false;
          if (btnTriggerAutoScan) {
            btnTriggerAutoScan.innerHTML = 'BẤM ĐO TỰ ĐỘNG (AUTO SCAN)';
          }
          return;
        }
      }
    } else if (state.mode === 'manual') {
      if (state.manualPoints.length < 4) {
        state.manualPoints.push({ x: cx, y: cy });
        const stepNum = state.manualPoints.length + 1;
        if (manualStepBanner) {
          if (stepNum <= 4) {
            manualStepBanner.textContent = `BƯỚC ${stepNum}: Click chọn Điểm P${stepNum}...`;
          } else {
            manualStepBanner.textContent = `Đã chọn đủ 4 điểm. Hệ thống đã tính toán kết quả đo bên phải.`;
          }
        }
        render();
      }
    }
  });

  window.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;

    if (state.draggedHandle) {
      const clampedX = Math.max(20, Math.min(rect.width - 20, cx));
      const clampedY = Math.max(30, Math.min(rect.height * 0.74, cy));

      if (state.draggedHandle === 'leftTop') {
        state.wallLeft.topX = clampedX;
        state.wallLeft.topY = clampedY;
      } else if (state.draggedHandle === 'leftBot') {
        state.wallLeft.botX = clampedX;
        state.wallLeft.botY = clampedY;
      } else if (state.draggedHandle === 'rightTop') {
        state.wallRight.topX = clampedX;
        state.wallRight.topY = clampedY;
      } else if (state.draggedHandle === 'rightBot') {
        state.wallRight.botX = clampedX;
        state.wallRight.botY = clampedY;
      }
      render();
    } else {
      const handles = [
        { x: state.wallLeft.topX, y: state.wallLeft.topY, id: 'leftTop' },
        { x: state.wallLeft.botX, y: state.wallLeft.botY, id: 'leftBot' },
        { x: state.wallRight.topX, y: state.wallRight.topY, id: 'rightTop' },
        { x: state.wallRight.botX, y: state.wallRight.botY, id: 'rightBot' }
      ];
      let foundHover = null;
      for (let h of handles) {
        if (Math.hypot(h.x - cx, h.y - cy) <= HANDLE_RADIUS + 6) {
          foundHover = h.id;
          break;
        }
      }
      if (foundHover !== state.hoveredHandle) {
        state.hoveredHandle = foundHover;
        canvas.style.cursor = foundHover ? 'grab' : (state.mode === 'manual' ? 'crosshair' : 'default');
        render();
      }
    }
  });

  window.addEventListener('mouseup', () => {
    if (state.draggedHandle) {
      state.draggedHandle = null;
      render();
    }
  });

  // Slider Listeners
  if (sliderThresh && threshValBadge) {
    sliderThresh.addEventListener('input', (e) => {
      state.threshold = parseInt(e.target.value);
      threshValBadge.textContent = state.threshold;
      // When threshold is tweaked, if measured, update live
      if (state.isMeasured) render();
    });
  }

  if (sliderRatio && ratioValBadge) {
    sliderRatio.addEventListener('input', (e) => {
      state.ratioNm = parseFloat(e.target.value);
      ratioValBadge.textContent = `${state.ratioNm.toFixed(2)} nm/px`;
      if (state.isMeasured) render();
    });
  }

  if (chkAutoCorrect) {
    chkAutoCorrect.addEventListener('change', (e) => {
      state.autoCorrect = e.target.checked;
      if (state.isMeasured) render();
    });
  }

  if (btnResetCanvas) {
    btnResetCanvas.addEventListener('click', () => {
      setPreset('standard');
      state.isMeasured = false; // Reset to unmeasured
      stepBadges.forEach(b => { if (b) b.className = 'timeline-step-badge'; });
      if (btnTriggerAutoScan) {
        btnTriggerAutoScan.innerHTML = 'BẤM ĐO TỰ ĐỘNG (AUTO SCAN)';
      }
      if (state.mode === 'manual') {
        state.manualPoints = [];
        if (manualStepBanner) {
          manualStepBanner.textContent = 'BƯỚC 1 (Chế độ phụ): Click chuột vào ảnh để chọn Điểm P1 (Đỉnh mép trái)';
        }
      }
      render();
    });
  }

  function setPreset(key) {
    const p = presets[key];
    if (!p) return;
    state.wallLeft.topX = p.wallLeft.topX;
    state.wallLeft.topY = p.wallLeft.topY;
    state.wallLeft.botX = p.wallLeft.botX;
    state.wallLeft.botY = p.wallLeft.botY;

    state.wallRight.topX = p.wallRight.topX;
    state.wallRight.topY = p.wallRight.topY;
    state.wallRight.botX = p.wallRight.botX;
    state.wallRight.botY = p.wallRight.botY;

    state.isMeasured = false; // Require click to measure on new preset!
    stepBadges.forEach(b => { if (b) b.className = 'timeline-step-badge'; });
    if (btnTriggerAutoScan) {
      btnTriggerAutoScan.innerHTML = 'BẤM ĐO TỰ ĐỘNG (AUTO SCAN)';
    }

    presetBtns.forEach(b => {
      b.classList.toggle('active', b.dataset.preset === key);
    });

    render();
  }

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      setPreset(btn.dataset.preset);
    });
  });

  // Initial scaling and render
  window.addEventListener('resize', resizeCanvas);
  setTimeout(resizeCanvas, 100);
}

/* ==========================================================================
   2. IMAGE LIGHTBOX FOR HIGH-RES INSPECTION
   ========================================================================== */

function initImageLightbox() {
  const modal = document.getElementById('imageModal');
  const modalImg = document.getElementById('modalImage');
  const modalTitle = document.getElementById('modalTitle');
  const modalClose = document.getElementById('modalClose');
  const clickableFrames = document.querySelectorAll('.image-frame');

  if (!modal || !modalImg) return;

  clickableFrames.forEach(frame => {
    frame.addEventListener('click', () => {
      const img = frame.querySelector('img');
      const title = frame.dataset.title || img.alt || 'Chi tiết hình ảnh';
      if (img) {
        modalImg.src = img.src;
        modalTitle.textContent = title;
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
      }
    });
  });

  function closeModal() {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }

  if (modalClose) modalClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
  });
}

/* ==========================================================================
   3. COPY CODE SNIPPETS
   ========================================================================== */

function initCopyCodeButtons() {
  const copyBtns = document.querySelectorAll('.btn-copy-code');
  copyBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const codeBlock = document.getElementById(targetId);
      if (codeBlock) {
        navigator.clipboard.writeText(codeBlock.innerText).then(() => {
          const originalText = btn.innerHTML;
          btn.innerHTML = 'Đã chép!';
          setTimeout(() => { btn.innerHTML = originalText; }, 2000);
        });
      }
    });
  });
}

/* ==========================================================================
   4. NAVIGATION ACTIVE SQUAREBOX & SMOOTH SCROLLING
   ========================================================================== */

function initNavScrollSpy() {
  const navLinks = document.querySelectorAll('.nav-links a');

  function setActive(targetId) {
    if (!targetId) return;
    const cleanId = targetId.startsWith('#') ? targetId.slice(1) : targetId;

    navLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href === `#${cleanId}`) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  // Smooth scroll and immediate active update on click
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
      const targetId = this.getAttribute('href');
      if (!targetId || targetId === '#') return;
      const targetElement = document.querySelector(targetId);
      if (targetElement) {
        e.preventDefault();
        setActive(targetId);
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Track sections dynamically as user scrolls
  const sectionIds = ['overview', 'visual-proof', 'simulator', 'workflow', 'algorithm', 'reliability'];
  const sections = sectionIds
    .map(id => document.getElementById(id))
    .filter(Boolean);

  let isClickScrolling = false;

  navLinks.forEach(a => {
    a.addEventListener('click', () => {
      isClickScrolling = true;
      setTimeout(() => { isClickScrolling = false; }, 800);
    });
  });

  window.addEventListener('scroll', () => {
    if (isClickScrolling) return;

    const scrollY = window.scrollY;
    const headerOffset = 180;

    let currentSectionId = '';
    for (let i = sections.length - 1; i >= 0; i--) {
      const sec = sections[i];
      const top = sec.offsetTop - headerOffset;
      if (scrollY >= top) {
        currentSectionId = sec.id;
        break;
      }
    }

    if (!currentSectionId && sections.length > 0) {
      currentSectionId = sections[0].id;
    }

    if (currentSectionId) {
      setActive(currentSectionId);
    }
  }, { passive: true });

  // Initial state based on current scroll position or hash
  const initialHash = window.location.hash;
  if (initialHash && document.querySelector(initialHash)) {
    setActive(initialHash);
  } else {
    setActive('overview');
  }
}
