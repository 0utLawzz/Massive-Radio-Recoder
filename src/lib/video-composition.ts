import * as d3 from "d3";

/**
 * 1920x1080 Full HD (16:9) Video Composition Engine for YouTube / Video Capture.
 * Uses D3 scales & path generators on HTML5 Canvas 2D to render rotating vinyl disc
 * with artwork/badge, live reactive D3 audio visualizer (or static standby layout),
 * cyber scanline HUD overlay, track typography, and telemetry.
 */

export type BattlestationTheme = "gold" | "cyan" | "purple";
export type VisualizerMode = "spectrum" | "oscilloscope" | "reactor";

export type CompositionTheme = {
  primary: string;
  accent: string;
  secondary: string;
  glow: string;
  grid: string;
  dark: string;
  bgRgba: string;
};

export const THEME_PALETTES: Record<BattlestationTheme, CompositionTheme> = {
  gold: {
    primary: "#ffb01f",
    accent: "#ffd447",
    secondary: "#00f0ff",
    glow: "rgba(255, 176, 31, 0.45)",
    grid: "rgba(255, 176, 31, 0.12)",
    dark: "#0b0c10",
    bgRgba: "rgba(255, 176, 31, 0.05)",
  },
  cyan: {
    primary: "#00f0ff",
    accent: "#39ff14",
    secondary: "#c026d3",
    glow: "rgba(0, 240, 255, 0.45)",
    grid: "rgba(0, 240, 255, 0.12)",
    dark: "#050d14",
    bgRgba: "rgba(0, 240, 255, 0.05)",
  },
  purple: {
    primary: "#c026d3",
    accent: "#00f0ff",
    secondary: "#ffb01f",
    glow: "rgba(192, 38, 211, 0.45)",
    grid: "rgba(192, 38, 211, 0.12)",
    dark: "#0e0517",
    bgRgba: "rgba(192, 38, 211, 0.05)",
  },
};

export type RenderCompositionOptions = {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  freqBins: Uint8Array;
  timeDomainBins: Uint8Array;
  isLive: boolean;
  visualizerEnabled: boolean;
  theme: BattlestationTheme;
  vizMode: VisualizerMode;
  artist: string;
  title: string;
  stationName: string;
  bitrate: number;
  artworkImage: HTMLImageElement | null;
  badgeImage?: HTMLImageElement | null;
  vinylAngle: number;
  recording: boolean;
  recordElapsedMs: number;
  recordBytes: number;
  peakDb: string;
  bassLevel: number;
  midLevel: number;
  trebleLevel: number;
};

export function renderVideoComposition(opts: RenderCompositionOptions) {
  const {
    ctx,
    width,
    height,
    freqBins,
    timeDomainBins,
    isLive,
    visualizerEnabled,
    theme,
    vizMode,
    artist,
    title,
    stationName,
    bitrate,
    artworkImage,
    badgeImage,
    vinylAngle,
    recording,
    recordElapsedMs,
    recordBytes,
    bassLevel,
    midLevel,
    trebleLevel,
  } = opts;

  const palette = THEME_PALETTES[theme];

  // 1. Cyberpunk Studio Background (deep dark metallic slate with vignette)
  ctx.save();
  ctx.fillStyle = "#06080d";
  ctx.fillRect(0, 0, width, height);

  // Radial ambient gradient flare matching theme
  const bgGrad = ctx.createRadialGradient(width * 0.28, height * 0.5, 50, width * 0.28, height * 0.5, 800);
  bgGrad.addColorStop(0, palette.bgRgba);
  bgGrad.addColorStop(1, "transparent");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle isometric background grid
  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;
  const gridSize = 48;
  ctx.beginPath();
  for (let x = 0; x < width; x += gridSize) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = 0; y < height; y += gridSize) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();

  // Corner HUD brackets
  const bracketSize = 32;
  const margin = 28;
  ctx.strokeStyle = palette.primary;
  ctx.lineWidth = 3;

  // Top Left
  ctx.beginPath();
  ctx.moveTo(margin, margin + bracketSize);
  ctx.lineTo(margin, margin);
  ctx.lineTo(margin + bracketSize, margin);
  ctx.stroke();

  // Top Right
  ctx.beginPath();
  ctx.moveTo(width - margin - bracketSize, margin);
  ctx.lineTo(width - margin, margin);
  ctx.lineTo(width - margin, margin + bracketSize);
  ctx.stroke();

  // Bottom Left
  ctx.beginPath();
  ctx.moveTo(margin, height - margin - bracketSize);
  ctx.lineTo(margin, height - margin);
  ctx.lineTo(margin + bracketSize, height - margin);
  ctx.stroke();

  // Bottom Right
  ctx.beginPath();
  ctx.moveTo(width - margin - bracketSize, height - margin);
  ctx.lineTo(width - margin, height - margin);
  ctx.lineTo(width - margin, height - margin - bracketSize);
  ctx.stroke();

  // 2. Rotating Vinyl Record Presentation (Left side: cx = 460, cy = 540)
  const vinylCx = 460;
  const vinylCy = height / 2;
  const vinylRadius = 320; // 640px diameter

  ctx.save();
  ctx.translate(vinylCx, vinylCy);

  // Vinyl outer shadow
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = isLive ? 35 + bassLevel * 25 : 20;

  // Outer edge rim
  ctx.beginPath();
  ctx.arc(0, 0, vinylRadius, 0, Math.PI * 2);
  ctx.fillStyle = "#0c0d12";
  ctx.fill();
  ctx.shadowBlur = 0;

  // Thin outer theme accent rim highlight
  ctx.strokeStyle = palette.primary;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Rotate vinyl disc for grooves, reflections and label
  ctx.rotate(vinylAngle);

  // Dark vinyl disc body
  ctx.beginPath();
  ctx.arc(0, 0, vinylRadius - 4, 0, Math.PI * 2);
  ctx.fillStyle = "#11141c";
  ctx.fill();

  // Microgrooves (concentric subtle rings)
  ctx.lineWidth = 1;
  const grooveStart = 150;
  const grooveEnd = vinylRadius - 10;
  for (let r = grooveStart; r < grooveEnd; r += 6) {
    ctx.strokeStyle = r % 18 === 0 ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.02)";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Realistic vinyl light reflections (anisotropic sheen wedges)
  const sheenGrad1 = ctx.createLinearGradient(-vinylRadius, -vinylRadius, vinylRadius, vinylRadius);
  sheenGrad1.addColorStop(0, "rgba(255, 255, 255, 0.08)");
  sheenGrad1.addColorStop(0.5, "transparent");
  sheenGrad1.addColorStop(1, "rgba(255, 255, 255, 0.08)");
  ctx.fillStyle = sheenGrad1;
  ctx.beginPath();
  ctx.arc(0, 0, vinylRadius - 8, 0, Math.PI * 2);
  ctx.fill();

  // Center Vinyl Label / Album Artwork / Selected OutLawZ Badge (Radius 135px -> 270px diameter)
  const labelRadius = 135;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, labelRadius, 0, Math.PI * 2);
  ctx.clip();

  const activeCenterImg =
    artworkImage && artworkImage.complete && artworkImage.naturalWidth > 0
      ? artworkImage
      : badgeImage && badgeImage.complete && badgeImage.naturalWidth > 0
      ? badgeImage
      : null;

  if (activeCenterImg) {
    ctx.drawImage(activeCenterImg, -labelRadius, -labelRadius, labelRadius * 2, labelRadius * 2);

    // Subtle dark circular vignette on label border
    const artVignette = ctx.createRadialGradient(0, 0, labelRadius * 0.6, 0, 0, labelRadius);
    artVignette.addColorStop(0, "transparent");
    artVignette.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    ctx.fillStyle = artVignette;
    ctx.fillRect(-labelRadius, -labelRadius, labelRadius * 2, labelRadius * 2);
  } else {
    // Stylized Cyberpunk OutLawZ Default Vinyl Artwork
    const labelGrad = ctx.createRadialGradient(0, 0, 10, 0, 0, labelRadius);
    labelGrad.addColorStop(0, palette.dark);
    labelGrad.addColorStop(1, "#020406");
    ctx.fillStyle = labelGrad;
    ctx.fillRect(-labelRadius, -labelRadius, labelRadius * 2, labelRadius * 2);

    // Concentric circuit rings
    ctx.strokeStyle = palette.primary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, labelRadius - 10, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = palette.grid;
    ctx.beginPath();
    ctx.arc(0, 0, labelRadius - 25, 0, Math.PI * 2);
    ctx.stroke();

    // OutLawZ Center Typography
    ctx.font = "bold 22px 'Orbitron', sans-serif";
    ctx.fillStyle = palette.primary;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("OutLawZ™", 0, -32);

    ctx.font = "12px 'Share Tech Mono', monospace";
    ctx.fillStyle = "#ffffff";
    ctx.fillText("BE THE NAME", 0, -10);

    ctx.font = "bold 11px 'Rajdhani', sans-serif";
    ctx.fillStyle = palette.accent;
    ctx.fillText("33⅓ RPM · STEREO", 0, 32);

    ctx.font = "10px 'Share Tech Mono', monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillText("HI-FI BROADCAST", 0, 52);
  }

  ctx.restore();

  // Vinyl Center Spindle Hole & Metallic Ring
  ctx.strokeStyle = palette.primary;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, labelRadius, 0, Math.PI * 2);
  ctx.stroke();

  // Spindle center metal ring
  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.fillStyle = "#262c38";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Center hole cutout
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.fillStyle = "#06080d";
  ctx.fill();

  ctx.restore(); // restore vinyl rotation & translation

  // 3. Right Side: Track Information & Live D3 Visualizer
  const infoLeft = 860;
  const contentWidth = width - infoLeft - 60;

  ctx.textAlign = "left";
  ctx.textBaseline = "top";

  // Glowing status capsule
  const badgeY = 160;
  ctx.fillStyle = palette.primary;
  ctx.beginPath();
  ctx.arc(infoLeft + 8, badgeY + 12, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = "bold 18px 'Share Tech Mono', monospace";
  ctx.fillStyle = palette.primary;
  ctx.fillText("LIVE BROADCAST", infoLeft + 24, badgeY + 2);

  ctx.font = "18px 'Share Tech Mono', monospace";
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.fillText(`//  ${stationName.toUpperCase()}  //  ${bitrate} KBPS ICECAST`, infoLeft + 200, badgeY + 2);

  // Large Track Title (Truncate cleanly if too long)
  const displayTitle = (title || "WAITING FOR METADATA...").trim();
  ctx.font = "bold 46px 'Orbitron', sans-serif";
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = 15;

  let titleY = badgeY + 45;
  let fitTitle = displayTitle;
  if (ctx.measureText(fitTitle).width > contentWidth) {
    while (fitTitle.length > 10 && ctx.measureText(fitTitle + "...").width > contentWidth) {
      fitTitle = fitTitle.slice(0, -1);
    }
    fitTitle += "...";
  }
  ctx.fillText(fitTitle, infoLeft, titleY);
  ctx.shadowBlur = 0;

  // Artist Name
  const displayArtist = (artist || "MASSIVE RADIO STREAM").trim();
  titleY += 62;
  ctx.font = "bold 32px 'Rajdhani', sans-serif";
  ctx.fillStyle = palette.primary;
  ctx.fillText(displayArtist.toUpperCase(), infoLeft, titleY);

  // Horizontal Tech Divider
  titleY += 50;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(infoLeft, titleY);
  ctx.lineTo(infoLeft + contentWidth, titleY);
  ctx.stroke();

  // 4. Live D3 Audio Visualizer Box (16:9 inner module)
  const vizX = infoLeft;
  const vizY = titleY + 30;
  const vizWidth = contentWidth;
  const vizHeight = 320;

  // Viz Box background
  ctx.fillStyle = "rgba(10, 14, 22, 0.88)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(vizX, vizY, vizWidth, vizHeight);
  ctx.fill();
  ctx.stroke();

  // Viz Header
  ctx.font = "14px 'Share Tech Mono', monospace";
  ctx.fillStyle = palette.primary;
  const modeLabel = visualizerEnabled
    ? `D3 FREQUENCY MATRIX // MODE: ${vizMode.toUpperCase()}`
    : "D3 FREQUENCY MATRIX // STATIC LAYOUT";
  ctx.fillText(modeLabel, vizX + 16, vizY + 16);

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.fillText(`PEAK: ${opts.peakDb}`, vizX + vizWidth - 16, vizY + 16);
  ctx.textAlign = "left";

  // Visualizer Render Area
  const innerVizX = vizX + 16;
  const innerVizY = vizY + 46;
  const innerVizW = vizWidth - 32;
  const innerVizH = vizHeight - 66;

  // Subtle D3 reference grid inside visualizer box
  const yGridScale = d3.scaleLinear().domain([0, 100]).range([innerVizY + innerVizH, innerVizY]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 1;
  for (const tick of [25, 50, 75]) {
    const gy = yGridScale(tick);
    ctx.beginPath();
    ctx.moveTo(innerVizX, gy);
    ctx.lineTo(innerVizX + innerVizW, gy);
    ctx.stroke();
  }

  if (!visualizerEnabled) {
    // Static Layout Mode (clean cyber grid + center horizon + calibration markers)
    const centerY = innerVizY + innerVizH / 2;
    ctx.strokeStyle = palette.primary;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(innerVizX, centerY);
    ctx.lineTo(innerVizX + innerVizW, centerY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // D3 Static tick notches along baseline
    const xTicks = d3.scaleLinear().domain([0, 20]).range([innerVizX, innerVizX + innerVizW]);
    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 1.5;
    for (let t = 0; t <= 20; t++) {
      const tx = xTicks(t);
      const tickH = t % 5 === 0 ? 18 : 8;
      ctx.beginPath();
      ctx.moveTo(tx, centerY - tickH);
      ctx.lineTo(tx, centerY + tickH);
      ctx.stroke();
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 16px 'Orbitron', sans-serif";
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.fillText("VISUALIZER: STATIC HUD LAYOUT", innerVizX + innerVizW / 2, centerY - 28);
    ctx.font = "12px 'Share Tech Mono', monospace";
    ctx.fillStyle = palette.primary;
    ctx.fillText("CLICK 'TOGGLE VISUALIZER' TO ENGAGE DYNAMIC D3 WAVEFORM", innerVizX + innerVizW / 2, centerY + 30);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
  } else if (isLive) {
    if (vizMode === "spectrum") {
      // D3 ScaleBand + ScaleLinear + Theme Color Interpolator (Cyan / Gold / Purple)
      const barCount = 48;
      const indices = d3.range(barCount);
      const xScale = d3
        .scaleBand<number>()
        .domain(indices)
        .range([innerVizX, innerVizX + innerVizW])
        .paddingInner(0.18);

      const yScale = d3.scaleLinear().domain([0, 255]).range([0, innerVizH * 0.92]);

      const colorScale = d3
        .scaleLinear<string>()
        .domain([0, 0.5, 0.85, 1])
        .range([palette.primary, palette.secondary, palette.accent, "#ff2a51"])
        .clamp(true);

      const barW = xScale.bandwidth();
      const half = Math.floor(barCount / 2);

      for (const i of indices) {
        const dist = Math.abs(i - (barCount - 1) / 2);
        const norm = half > 0 ? dist / half : 0;
        const binIdx = Math.min(freqBins.length - 1, Math.floor(norm * (freqBins.length * 0.8)));
        const raw = freqBins[binIdx] || 0;
        const barH = Math.max(6, yScale(raw));
        const bx = xScale(i) ?? innerVizX;
        const by = innerVizY + innerVizH - barH;
        const ratio = raw / 255;

        // Multi-stop cyber gradient per bar
        const barGrad = ctx.createLinearGradient(0, innerVizY + innerVizH, 0, by);
        barGrad.addColorStop(0, palette.primary);
        barGrad.addColorStop(0.55, palette.secondary);
        barGrad.addColorStop(1, colorScale(ratio));

        ctx.fillStyle = barGrad;
        ctx.fillRect(bx, by, barW, barH);

        // Glowing peak cap
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(bx, Math.max(innerVizY, by - 4), barW, 2.5);
      }
    } else if (vizMode === "oscilloscope") {
      // D3 ScaleLinear + D3 Monotone Curve Line + Area Fill on Canvas 2D
      const samples = Array.from(timeDomainBins);
      const xScale = d3
        .scaleLinear()
        .domain([0, Math.max(1, samples.length - 1)])
        .range([innerVizX, innerVizX + innerVizW]);

      const yScale = d3
        .scaleLinear()
        .domain([0, 255])
        .range([innerVizY + innerVizH, innerVizY]);

      // Glowing area beneath curve
      const areaGen = d3
        .area<number>()
        .x((_d, i) => xScale(i))
        .y0(innerVizY + innerVizH / 2)
        .y1((d) => yScale(d))
        .curve(d3.curveMonotoneX)
        .context(ctx);

      ctx.save();
      const areaGrad = ctx.createLinearGradient(0, innerVizY, 0, innerVizY + innerVizH);
      areaGrad.addColorStop(0, palette.glow);
      areaGrad.addColorStop(0.5, "rgba(0,0,0,0)");
      areaGrad.addColorStop(1, palette.glow);
      ctx.fillStyle = areaGrad;
      ctx.beginPath();
      areaGen(samples);
      ctx.fill();

      // Primary D3 waveform trace
      const lineGen = d3
        .line<number>()
        .x((_d, i) => xScale(i))
        .y((d) => yScale(d))
        .curve(d3.curveMonotoneX)
        .context(ctx);

      ctx.lineWidth = 3.5;
      ctx.strokeStyle = palette.primary;
      ctx.shadowColor = palette.accent;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      lineGen(samples);
      ctx.stroke();
      ctx.restore();
    } else if (vizMode === "reactor") {
      // D3 ScaleLinear + D3 LineRadial closed spline
      const rcx = innerVizX + innerVizW / 2;
      const rcy = innerVizY + innerVizH / 2;
      const maxR = Math.min(innerVizW, innerVizH) / 2 - 10;

      ctx.strokeStyle = palette.grid;
      ctx.lineWidth = 1;
      for (const frac of [0.25, 0.5, 0.75, 1]) {
        ctx.beginPath();
        ctx.arc(rcx, rcy, maxR * frac, 0, Math.PI * 2);
        ctx.stroke();
      }

      const points = 64;
      const radialData = d3.range(points).map((i) => freqBins[i % 32] || 0);
      const radiusScale = d3.scaleLinear().domain([0, 255]).range([maxR * 0.35, maxR]);
      const angleScale = d3.scaleLinear().domain([0, points]).range([0, Math.PI * 2]);

      const radialLine = d3
        .lineRadial<number>()
        .angle((_d, i) => angleScale(i))
        .radius((d) => radiusScale(d))
        .curve(d3.curveCardinalClosed)
        .context(ctx);

      ctx.save();
      ctx.translate(rcx, rcy);
      ctx.strokeStyle = palette.primary;
      ctx.lineWidth = 3;
      ctx.shadowColor = palette.glow;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      radialLine(radialData);
      ctx.stroke();

      // Inner accent ring
      ctx.strokeStyle = palette.secondary;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      radialLine(radialData.map((v) => v * 0.72));
      ctx.stroke();
      ctx.restore();
    }
  } else {
    // Live idle gentle cyber wave rendered with D3 line
    const time = Date.now() * 0.002;
    const idleCount = 60;
    const xScale = d3.scaleLinear().domain([0, idleCount - 1]).range([innerVizX, innerVizX + innerVizW]);
    const idleData = d3.range(idleCount).map((i) => innerVizY + innerVizH / 2 + Math.sin(i * 0.28 + time) * 14);
    const idleLine = d3
      .line<number>()
      .x((_d, i) => xScale(i))
      .y((d) => d)
      .curve(d3.curveMonotoneX)
      .context(ctx);

    ctx.strokeStyle = palette.grid;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    idleLine(idleData);
    ctx.stroke();
  }

  // Cyber CRT Scanline Overlay inside the Visualizer Stage
  ctx.save();
  ctx.beginPath();
  ctx.rect(vizX, vizY, vizWidth, vizHeight);
  ctx.clip();
  ctx.fillStyle = "rgba(0, 0, 0, 0.24)";
  for (let sy = vizY; sy < vizY + vizHeight; sy += 4) {
    ctx.fillRect(vizX, sy, vizWidth, 1.5);
  }
  const sweepY = vizY + ((Date.now() * 0.08) % vizHeight);
  const sweepGrad = ctx.createLinearGradient(0, sweepY - 18, 0, sweepY + 18);
  sweepGrad.addColorStop(0, "transparent");
  sweepGrad.addColorStop(0.5, palette.bgRgba);
  sweepGrad.addColorStop(1, "transparent");
  ctx.fillStyle = sweepGrad;
  ctx.fillRect(vizX, sweepY - 18, vizWidth, 36);
  ctx.restore();

  // 5. Frequency band telemetry meters below visualizer
  const meterY = vizY + vizHeight + 24;
  const meterColW = (contentWidth - 40) / 3;

  const meters = [
    { label: "SUB-BASS", val: bassLevel },
    { label: "MIDRANGE", val: midLevel },
    { label: "HIGHS / AIR", val: trebleLevel },
  ];

  meters.forEach((m, idx) => {
    const mx = infoLeft + idx * (meterColW + 20);
    ctx.font = "13px 'Share Tech Mono', monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillText(m.label, mx, meterY);

    ctx.textAlign = "right";
    ctx.fillStyle = palette.primary;
    ctx.fillText(`${Math.round(m.val * 100)}%`, mx + meterColW, meterY);
    ctx.textAlign = "left";

    // Meter bar background
    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    ctx.fillRect(mx, meterY + 18, meterColW, 8);

    // Meter bar fill
    ctx.fillStyle = palette.primary;
    ctx.fillRect(mx, meterY + 18, Math.max(4, meterColW * m.val), 8);
  });

  // 6. OutLawZ Bottom Branding & Watermark
  const brandY = height - 60;
  ctx.font = "bold 20px 'Orbitron', sans-serif";
  ctx.fillStyle = palette.primary;
  ctx.fillText("OutLawZ™", margin + 10, brandY);

  ctx.font = "14px 'Share Tech Mono', monospace";
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.fillText("// BE THE NAME · FULL HD 1080P RECORDING CORE", margin + 140, brandY + 4);

  // 7. Video Recording Live Overlay Indicator (Top Right)
  if (recording) {
    const isFlash = Math.floor(Date.now() / 400) % 2 === 0;
    const recBoxW = 280;
    const recBoxH = 46;
    const recX = width - margin - recBoxW;
    const recY = margin + 10;

    // Glowing REC container
    ctx.fillStyle = "rgba(25, 4, 8, 0.9)";
    ctx.strokeStyle = "#ff2a51";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(recX, recY, recBoxW, recBoxH);
    ctx.fill();
    ctx.stroke();

    if (isFlash) {
      ctx.fillStyle = "#ff2a51";
      ctx.beginPath();
      ctx.arc(recX + 24, recY + 23, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.font = "bold 16px 'Orbitron', sans-serif";
    ctx.fillStyle = "#ff2a51";
    ctx.fillText("REC 1080P", recX + 44, recY + 14);

    // Elapsed Duration
    const totalSec = Math.floor(recordElapsedMs / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    ctx.font = "bold 15px 'Share Tech Mono', monospace";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`${mm}:${ss}`, recX + 160, recY + 15);

    // Captured size
    const mb = (recordBytes / (1024 * 1024)).toFixed(1);
    ctx.font = "12px 'Share Tech Mono', monospace";
    ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
    ctx.fillText(`${mb} MB`, recX + 225, recY + 16);
  }

  // 8. Global Subtle Cyber Scanlines across full 16:9 canvas
  ctx.fillStyle = "rgba(0, 0, 0, 0.14)";
  for (let y = 0; y < height; y += 6) {
    ctx.fillRect(0, y, width, 1);
  }

  ctx.restore();
}
