import * as d3 from "d3";

/**
 * 1920x1080 Full HD (16:9) Video Composition Engine for YouTube / Video Capture.
 * Uses D3 scales & path generators on HTML5 Canvas 2D to render rotating vinyl disc
 * with radial spectrum halo, live reactive D3 audio visualizers (Spectrum, Laser Wave,
 * Reactor Radar, Retro LED Lights, Horizon Bars, 3D Light Tunnel), old-fashioned
 * music lights bezel, cyber scanline HUD overlay, track typography, and telemetry.
 */

export type BattlestationTheme = "gold" | "cyan" | "purple";
export type VisualizerMode =
  | "spectrum"
  | "oscilloscope"
  | "reactor"
  | "retro-leds"
  | "horizon-bars"
  | "disco-tunnel";

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
  musicLightsEnabled?: boolean;
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
  kickPulse?: number;
  bpm?: number | null;
  beatPhase?: number;
  bpmConfidence?: number;
};

const RETRO_BULB_PALETTE = [
  "#ff3b5c",
  "#ffb01f",
  "#ffe600",
  "#39ff14",
  "#00f0ff",
  "#3b82f6",
  "#d946ef",
];

/**
 * Perceptual logarithmic frequency sampler locked to detected BPM rhythm & bass/kick transients.
 * Bar amplitude scaling and wave modulation respond directly to rhythmic pulses and tempo.
 */
function sampleBandEnergy(
  freqBins: Uint8Array,
  normPos: number,
  bassLevel: number,
  midLevel: number,
  kickPulse = 0,
  beatPhase = 0,
  tempoScale = 1,
): number {
  const maxActiveBin = Math.min(freqBins.length - 1, 150); // ~0 Hz to ~14 kHz active musical range
  const curved = Math.pow(Math.max(0, Math.min(1, normPos)), 1.55);
  const centerIdx = Math.floor(curved * maxActiveBin);
  const prev = freqBins[Math.max(0, centerIdx - 1)] || 0;
  const cur = freqBins[centerIdx] || 0;
  const next = freqBins[Math.min(maxActiveBin, centerIdx + 1)] || 0;
  const rawAvg = (prev * 0.25 + cur * 0.5 + next * 0.25) / 255;

  // Rhythmic harmonic wave synced to BPM beatPhase across the bar array
  const beatHarmonic = Math.max(0, Math.cos((beatPhase - normPos * 0.35) * Math.PI * 2));
  const trebleGain = 1 + curved * 0.65;
  const bassDrive = bassLevel * 0.42 + kickPulse * 0.54 * tempoScale;
  const bandSync = rawAvg * (trebleGain + bassDrive * 0.7);
  const kickLift =
    kickPulse * (0.28 - 0.1 * normPos) +
    beatHarmonic * (kickPulse * 0.14 + bassLevel * 0.08) +
    bassLevel * 0.1 +
    midLevel * 0.05;
  return Math.min(1, bandSync + kickLift);
}

export function renderVideoComposition(opts: RenderCompositionOptions) {
  const {
    ctx,
    width,
    height,
    freqBins,
    timeDomainBins,
    isLive,
    visualizerEnabled,
    musicLightsEnabled = true,
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
    kickPulse = 0,
    bpm = null,
    beatPhase = 0,
    bpmConfidence = 0,
  } = opts;

  const palette = THEME_PALETTES[theme];
  const nowMs = Date.now();
  const tempoScale = bpm ? Math.max(0.65, Math.min(1.6, bpm / 120)) : 1;

  // 1. Cyberpunk Studio Background (deep dark metallic slate with vignette)
  ctx.save();
  ctx.fillStyle = "#06080d";
  ctx.fillRect(0, 0, width, height);

  // Radial ambient gradient flare matching theme (pulses on kick)
  const bgGrad = ctx.createRadialGradient(
    width * 0.28,
    height * 0.5,
    50,
    width * 0.28,
    height * 0.5,
    820 + (isLive ? kickPulse * 140 * tempoScale : 0),
  );
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

  // Old-Fashioned Music Lights along top & bottom studio rails (chase speed locked to BPM beatPhase)
  if (musicLightsEnabled) {
    const bulbCount = 30;
    const marginX = 90;
    const stepX = (width - marginX * 2) / (bulbCount - 1);
    const chasePhase = isLive && bpm ? Math.floor(beatPhase * 4) : Math.floor(nowMs / (150 / tempoScale));

    for (let i = 0; i < bulbCount; i++) {
      const bx = marginX + i * stepX;
      const bandNorm = i / (bulbCount - 1);
      const bandVal = isLive
        ? sampleBandEnergy(freqBins, bandNorm, bassLevel, midLevel, kickPulse, beatPhase, tempoScale)
        : 0.25 + 0.2 * Math.sin(nowMs * 0.004 + i * 0.5);
      const isChaseOn = (i + chasePhase) % 3 === 0;
      const intensity = isLive
        ? Math.min(1, 0.28 + bandVal * 0.72 + kickPulse * 0.35 + (isChaseOn ? 0.14 : 0))
        : isChaseOn
        ? 0.55
        : 0.2;
      const bulbColor = RETRO_BULB_PALETTE[i % RETRO_BULB_PALETTE.length];

      for (const by of [24, height - 24]) {
        ctx.save();
        ctx.globalAlpha = intensity;
        ctx.shadowColor = bulbColor;
        ctx.shadowBlur = isLive ? 14 + bassLevel * 18 + kickPulse * 24 * tempoScale : 8;
        ctx.fillStyle = bulbColor;
        ctx.beginPath();
        ctx.arc(bx, by, 7 + (isLive ? kickPulse * 2.5 : 0), 0, Math.PI * 2);
        ctx.fill();

        // Warm incandescent filament core
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ffffff";
        ctx.globalAlpha = intensity * 0.85;
        ctx.beginPath();
        ctx.arc(bx, by, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

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

  // 2. Rotating Vinyl Record Presentation + Radial Music Ring (Left side: cx = 460, cy = 540)
  const vinylCx = 460;
  const vinylCy = height / 2;
  const vinylRadius = 300;
  const kickScale = isLive ? 1 + kickPulse * 0.032 + bassLevel * 0.012 : 1;

  ctx.save();
  ctx.translate(vinylCx, vinylCy);
  ctx.scale(kickScale, kickScale);

  // Bass/Kick Shockwave Halo around Vinyl
  if (isLive && kickPulse > 0.08) {
    ctx.save();
    ctx.strokeStyle = palette.primary;
    ctx.globalAlpha = Math.min(0.65, kickPulse * 0.75);
    ctx.lineWidth = 2 + kickPulse * 4;
    ctx.beginPath();
    ctx.arc(0, 0, vinylRadius + 24 + kickPulse * 68, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Radial Outer Spectrum Ring around Vinyl (BPM-synced rotation & expansion)
  if (visualizerEnabled) {
    const radialBars = 72;
    const innerRingR = vinylRadius + 14;
    for (let i = 0; i < radialBars; i++) {
      const angle = (i / radialBars) * Math.PI * 2 - Math.PI / 2;
      const norm = (i % (radialBars / 2)) / (radialBars / 2);
      const energy = isLive
        ? sampleBandEnergy(freqBins, norm, bassLevel, midLevel, kickPulse, beatPhase, tempoScale)
        : 0.14 + 0.08 * Math.sin(nowMs * 0.003 + i * 0.35);
      const len = 10 + energy * (76 + kickPulse * 34 * tempoScale);

      const x1 = Math.cos(angle) * innerRingR;
      const y1 = Math.sin(angle) * innerRingR;
      const x2 = Math.cos(angle) * (innerRingR + len);
      const y2 = Math.sin(angle) * (innerRingR + len);

      const hue = ((i / radialBars) * 300 + nowMs * 0.02 * tempoScale) % 360;
      ctx.strokeStyle = isLive ? `hsl(${hue}, 95%, 60%)` : palette.grid;
      ctx.lineWidth = 4;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.lineCap = "butt";
  }

  // Vinyl outer shadow
  ctx.shadowColor = palette.glow;
  ctx.shadowBlur = isLive ? 35 + bassLevel * 25 + kickPulse * 30 : 20;

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
  const grooveStart = 145;
  const grooveEnd = vinylRadius - 10;
  for (let r = grooveStart; r < grooveEnd; r += 6) {
    ctx.strokeStyle = r % 18 === 0 ? "rgba(255, 255, 255, 0.08)" : "rgba(255, 255, 255, 0.02)";
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Realistic vinyl light reflections
  const sheenGrad1 = ctx.createLinearGradient(-vinylRadius, -vinylRadius, vinylRadius, vinylRadius);
  sheenGrad1.addColorStop(0, "rgba(255, 255, 255, 0.08)");
  sheenGrad1.addColorStop(0.5, "transparent");
  sheenGrad1.addColorStop(1, "rgba(255, 255, 255, 0.08)");
  ctx.fillStyle = sheenGrad1;
  ctx.beginPath();
  ctx.arc(0, 0, vinylRadius - 8, 0, Math.PI * 2);
  ctx.fill();

  // Center Vinyl Label / Album Artwork / Selected OutLawZ Badge
  const labelRadius = 130;
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

    const artVignette = ctx.createRadialGradient(0, 0, labelRadius * 0.6, 0, 0, labelRadius);
    artVignette.addColorStop(0, "transparent");
    artVignette.addColorStop(1, "rgba(0, 0, 0, 0.55)");
    ctx.fillStyle = artVignette;
    ctx.fillRect(-labelRadius, -labelRadius, labelRadius * 2, labelRadius * 2);
  } else {
    const labelGrad = ctx.createRadialGradient(0, 0, 10, 0, 0, labelRadius);
    labelGrad.addColorStop(0, palette.dark);
    labelGrad.addColorStop(1, "#020406");
    ctx.fillStyle = labelGrad;
    ctx.fillRect(-labelRadius, -labelRadius, labelRadius * 2, labelRadius * 2);

    ctx.strokeStyle = palette.primary;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, labelRadius - 10, 0, Math.PI * 2);
    ctx.stroke();

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
  }

  ctx.restore();

  // Vinyl Center Spindle Hole & Metallic Ring
  ctx.strokeStyle = palette.primary;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, labelRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(0, 0, 22, 0, Math.PI * 2);
  ctx.fillStyle = "#262c38";
  ctx.fill();
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.stroke();

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

  const badgeY = 148;
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

  // Large Track Title
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
  titleY += 48;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(infoLeft, titleY);
  ctx.lineTo(infoLeft + contentWidth, titleY);
  ctx.stroke();

  // 4. Live D3 Audio & Music Lights Visualizer Box
  const vizX = infoLeft;
  const vizY = titleY + 26;
  const vizWidth = contentWidth;
  const vizHeight = 350;

  ctx.fillStyle = "rgba(7, 10, 18, 0.92)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.14)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(vizX, vizY, vizWidth, vizHeight);
  ctx.fill();
  ctx.stroke();

  // Viz Header with Live Detected BPM
  ctx.font = "14px 'Share Tech Mono', monospace";
  ctx.fillStyle = palette.primary;
  const bpmTag = isLive ? (bpm ? `${bpm} BPM` : "TRACKING BPM") : "STANDBY";
  const modeLabel = visualizerEnabled
    ? `D3 SPECTRUM // ${vizMode.toUpperCase()} // ${bpmTag}`
    : "D3 SPECTRUM MATRIX // STATIC LAYOUT";
  ctx.fillText(modeLabel, vizX + 16, vizY + 14);

  ctx.textAlign = "right";
  ctx.fillStyle = kickPulse > 0.45 && isLive ? palette.accent : "rgba(255, 255, 255, 0.65)";
  const confText = bpm ? `LOCK ${Math.round(bpmConfidence * 100)}%` : "60Hz–16kHz";
  ctx.fillText(`PEAK: ${opts.peakDb} // KICK SYNC ${Math.round(kickPulse * 100)}% // ${confText}`, vizX + vizWidth - 16, vizY + 14);
  ctx.textAlign = "left";

  const innerVizX = vizX + 16;
  const innerVizY = vizY + 42;
  const innerVizW = vizWidth - 32;
  const innerVizH = vizHeight - 76;

  // D3 reference grid lines
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
    const centerY = innerVizY + innerVizH / 2;
    ctx.strokeStyle = palette.primary;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(innerVizX, centerY);
    ctx.lineTo(innerVizX + innerVizW, centerY);
    ctx.stroke();
    ctx.globalAlpha = 1;

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
    ctx.fillText("VISUALIZER: STATIC HUD LAYOUT", innerVizX + innerVizW / 2, centerY - 26);
    ctx.font = "12px 'Share Tech Mono', monospace";
    ctx.fillStyle = palette.primary;
    ctx.fillText("CLICK 'TOGGLE VISUALIZER' TO ENGAGE DYNAMIC D3 WAVEFORM", innerVizX + innerVizW / 2, centerY + 26);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
  } else if (isLive) {
    if (vizMode === "spectrum") {
      // Full-range D3 Spectrum locked to bass & kick transients so EVERY bar jumps on the beat
      const barCount = 48;
      const indices = d3.range(barCount);
      const xScale = d3
        .scaleBand<number>()
        .domain(indices)
        .range([innerVizX, innerVizX + innerVizW])
        .paddingInner(0.18);

      const yScale = d3.scaleLinear().domain([0, 1]).range([0, innerVizH * 0.94]);

      const colorScale = d3
        .scaleLinear<string>()
        .domain([0, 0.5, 0.85, 1])
        .range([palette.primary, palette.secondary, palette.accent, "#ff2a51"])
        .clamp(true);

      const barW = xScale.bandwidth();

      // Kick-sync floor glow
      if (kickPulse > 0.12) {
        ctx.save();
        const floorGlow = ctx.createLinearGradient(0, innerVizY + innerVizH - 48, 0, innerVizY + innerVizH);
        floorGlow.addColorStop(0, "transparent");
        floorGlow.addColorStop(1, palette.glow);
        ctx.globalAlpha = Math.min(0.85, kickPulse * 0.9);
        ctx.fillStyle = floorGlow;
        ctx.fillRect(innerVizX, innerVizY + innerVizH - 48, innerVizW, 48);
        ctx.restore();
      }

      for (const i of indices) {
        const normPos = i / (barCount - 1);
        const energy = sampleBandEnergy(freqBins, normPos, bassLevel, midLevel, kickPulse, beatPhase, tempoScale);
        const barH = Math.max(8, yScale(energy));
        const bx = xScale(i) ?? innerVizX;
        const by = innerVizY + innerVizH - barH;

        const barGrad = ctx.createLinearGradient(0, innerVizY + innerVizH, 0, by);
        barGrad.addColorStop(0, palette.primary);
        barGrad.addColorStop(0.55, palette.secondary);
        barGrad.addColorStop(1, colorScale(energy));

        ctx.fillStyle = barGrad;
        ctx.fillRect(bx, by, barW, barH);

        ctx.fillStyle = kickPulse > 0.5 ? palette.accent : "#ffffff";
        ctx.fillRect(bx, Math.max(innerVizY, by - 4 - kickPulse * 3), barW, 2.5);
      }
    } else if (vizMode === "oscilloscope") {
      const samples = Array.from(timeDomainBins);
      const xScale = d3
        .scaleLinear()
        .domain([0, Math.max(1, samples.length - 1)])
        .range([innerVizX, innerVizX + innerVizW]);

      const yScale = d3
        .scaleLinear()
        .domain([0, 255])
        .range([innerVizY + innerVizH, innerVizY]);

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

      const lineGen = d3
        .line<number>()
        .x((_d, i) => xScale(i))
        .y((d) => yScale(d))
        .curve(d3.curveMonotoneX)
        .context(ctx);

      ctx.lineWidth = 3.5 + kickPulse * 3;
      ctx.strokeStyle = palette.primary;
      ctx.shadowColor = palette.accent;
      ctx.shadowBlur = 14 + kickPulse * 18;
      ctx.beginPath();
      lineGen(samples);
      ctx.stroke();
      ctx.restore();
    } else if (vizMode === "reactor") {
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

      // Kick-synced pulsing inner core
      if (kickPulse > 0.05) {
        ctx.save();
        ctx.strokeStyle = palette.accent;
        ctx.globalAlpha = 0.35 + kickPulse * 0.55;
        ctx.lineWidth = 2 + kickPulse * 3;
        ctx.beginPath();
        ctx.arc(rcx, rcy, maxR * (0.18 + kickPulse * 0.22), 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      const points = 64;
      const radialData = d3
        .range(points)
        .map((i) => sampleBandEnergy(freqBins, (i % 32) / 31, bassLevel, midLevel, kickPulse, beatPhase, tempoScale) * 255);
      const radiusScale = d3.scaleLinear().domain([0, 255]).range([maxR * 0.32, maxR]);
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
      ctx.shadowBlur = 12 + kickPulse * 14;
      ctx.beginPath();
      radialLine(radialData);
      ctx.stroke();

      ctx.strokeStyle = palette.secondary;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      radialLine(radialData.map((v) => v * 0.72));
      ctx.stroke();
      ctx.restore();
    } else if (vizMode === "retro-leds") {
      // Old-Fashioned Glowing Circular LED Dot-Matrix Music Lights locked to BPM & bass/kick
      const cols = 28;
      const rows = 12;
      const colScale = d3
        .scaleBand<number>()
        .domain(d3.range(cols))
        .range([innerVizX, innerVizX + innerVizW])
        .paddingInner(0.22);
      const rowScale = d3
        .scaleBand<number>()
        .domain(d3.range(rows))
        .range([innerVizY + innerVizH, innerVizY])
        .paddingInner(0.24);

      const dotRadius = Math.min(colScale.bandwidth(), rowScale.bandwidth()) * (0.45 + kickPulse * 0.08);

      for (let c = 0; c < cols; c++) {
        const energy = sampleBandEnergy(freqBins, c / (cols - 1), bassLevel, midLevel, kickPulse, beatPhase, tempoScale);
        const litRows = Math.max(1, Math.round(energy * rows));
        const cx = (colScale(c) ?? innerVizX) + colScale.bandwidth() / 2;

        for (let r = 0; r < rows; r++) {
          const cy = (rowScale(r) ?? innerVizY) + rowScale.bandwidth() / 2;
          const isLit = r < litRows;
          const rowFrac = r / (rows - 1);

          let dotColor = "#00f0ff";
          if (rowFrac > 0.78) dotColor = "#ff2a51";
          else if (rowFrac > 0.5) dotColor = "#d946ef";
          else if (rowFrac > 0.25) dotColor = "#ffb01f";

          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
          if (isLit) {
            ctx.fillStyle = dotColor;
            ctx.shadowColor = dotColor;
            ctx.shadowBlur = 12 + kickPulse * 10;
            ctx.fill();
            // Bright bulb core
            ctx.shadowBlur = 0;
            ctx.fillStyle = "rgba(255, 255, 255, 0.65)";
            ctx.beginPath();
            ctx.arc(cx, cy, dotRadius * 0.35, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.fillStyle = "rgba(255, 255, 255, 0.06)";
            ctx.fill();
          }
          ctx.restore();
        }
      }
    } else if (vizMode === "horizon-bars") {
      // Glowing Neon Bars on 3D Reflective Perspective Grid Floor with BPM-Synced Sparks
      const horizonY = innerVizY + innerVizH * 0.74;
      const floorH = innerVizY + innerVizH - horizonY;

      // 3D perspective floor grid
      ctx.save();
      ctx.strokeStyle = palette.primary;
      ctx.globalAlpha = 0.28 + kickPulse * 0.35;
      ctx.lineWidth = 1;
      const vanishX = innerVizX + innerVizW / 2;
      for (let i = -8; i <= 8; i++) {
        ctx.beginPath();
        ctx.moveTo(vanishX + i * 32, horizonY);
        ctx.lineTo(vanishX + i * 115, innerVizY + innerVizH);
        ctx.stroke();
      }
      for (let r = 1; r <= 4; r++) {
        const y = horizonY + (r / 4) * floorH;
        ctx.beginPath();
        ctx.moveTo(innerVizX, y);
        ctx.lineTo(innerVizX + innerVizW, y);
        ctx.stroke();
      }
      ctx.restore();

      // Tall glowing columns + floor reflections
      const cols = 32;
      const xScale = d3
        .scaleBand<number>()
        .domain(d3.range(cols))
        .range([innerVizX, innerVizX + innerVizW])
        .paddingInner(0.28);
      const maxBarH = horizonY - innerVizY - 8;

      for (let c = 0; c < cols; c++) {
        const energy = sampleBandEnergy(freqBins, c / (cols - 1), bassLevel, midLevel, kickPulse, beatPhase, tempoScale);
        const h = Math.max(8, energy * maxBarH);
        const bx = xScale(c) ?? innerVizX;
        const bw = xScale.bandwidth();
        const by = horizonY - h;

        const barGrad = ctx.createLinearGradient(0, horizonY, 0, by);
        barGrad.addColorStop(0, "#ffffff");
        barGrad.addColorStop(0.25, palette.primary);
        barGrad.addColorStop(1, "#ff2a51");

        ctx.save();
        ctx.shadowColor = palette.primary;
        ctx.shadowBlur = 16 + kickPulse * 14;
        ctx.fillStyle = barGrad;
        ctx.fillRect(bx, by, bw, h);

        // Floor reflection
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.25 + kickPulse * 0.2;
        ctx.fillRect(bx, horizonY + 2, bw, Math.min(floorH - 4, h * 0.32));

        // Floating sparks burst upward at BPM tempo speed
        if (energy > 0.42 || kickPulse > 0.45) {
          ctx.globalAlpha = 0.85;
          ctx.fillStyle = "#ffd447";
          const sparkY = by - 8 - ((nowMs * 0.06 * tempoScale + c * 17) % (24 + kickPulse * 18));
          ctx.fillRect(bx + bw * 0.35, Math.max(innerVizY, sparkY), 3, 3);
        }
        ctx.restore();
      }

      // Bright kick-reactive horizon line
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2 + kickPulse * 2;
      ctx.beginPath();
      ctx.moveTo(innerVizX, horizonY);
      ctx.lineTo(innerVizX + innerVizW, horizonY);
      ctx.stroke();
    } else if (vizMode === "disco-tunnel") {
      // 3D Retro Mirrored Multi-Color LED Block Equalizer Tunnel locked to BPM & kick
      const centerX = innerVizX + innerVizW / 2;
      const centerY = innerVizY + innerVizH / 2;
      const colsPerSide = 14;
      const rows = 9;
      const halfW = innerVizW * 0.46;

      // Central light flare expands sharply on kicks
      const flare = ctx.createRadialGradient(centerX, centerY, 4, centerX, centerY, 130 + kickPulse * 95 * tempoScale);
      flare.addColorStop(0, "#ffffff");
      flare.addColorStop(0.35, palette.primary);
      flare.addColorStop(1, "transparent");
      ctx.fillStyle = flare;
      ctx.fillRect(innerVizX, innerVizY, innerVizW, innerVizH);

      for (const side of [-1, 1]) {
        for (let c = 0; c < colsPerSide; c++) {
          const depth = c / (colsPerSide - 1); // 0 = near outer edge, 1 = near center vanishing point
          const colX = centerX + side * (36 + (1 - depth) * halfW);
          const colW = Math.max(6, (1 - depth * 0.65) * 18);
          const colHalfH = (1 - depth * 0.62) * (innerVizH * 0.46);
          const energy = sampleBandEnergy(freqBins, depth, bassLevel, midLevel, kickPulse, beatPhase, tempoScale);
          const activeBlocks = Math.max(1, Math.round(energy * rows));
          const colColor = RETRO_BULB_PALETTE[(c + (side > 0 ? 2 : 0)) % RETRO_BULB_PALETTE.length];

          for (let r = 0; r < rows; r++) {
            const lit = r < activeBlocks;
            const blockH = Math.max(3, (colHalfH / rows) * 0.72);
            const stepY = (r + 0.5) * (colHalfH / rows);

            ctx.fillStyle = lit ? colColor : "rgba(255, 255, 255, 0.06)";
            if (lit) {
              ctx.shadowColor = colColor;
              ctx.shadowBlur = 8 + kickPulse * 10;
            } else {
              ctx.shadowBlur = 0;
            }
            // Symmetric top + bottom equalizer blocks
            ctx.fillRect(colX - colW / 2, centerY - stepY - blockH / 2, colW, blockH);
            ctx.fillRect(colX - colW / 2, centerY + stepY - blockH / 2, colW, blockH);
          }
          ctx.shadowBlur = 0;
        }
      }
    }
  } else {
    // Idle gentle cyber wave rendered with D3 line
    const time = nowMs * 0.002;
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

  // Frequency Axis Scale Labels at bottom of Visualizer Box (60Hz .. 16kHz + MHz carrier)
  const axisY = innerVizY + innerVizH + 10;
  const freqLabels = ["60Hz", "250Hz", "1kHz", "4kHz", "8kHz", "16kHz // 108.0 MHz"];
  const labelScale = d3.scaleLinear().domain([0, freqLabels.length - 1]).range([innerVizX, innerVizX + innerVizW]);
  ctx.font = "11px 'Share Tech Mono', monospace";
  ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
  freqLabels.forEach((lbl, idx) => {
    ctx.textAlign = idx === 0 ? "left" : idx === freqLabels.length - 1 ? "right" : "center";
    ctx.fillText(lbl, labelScale(idx), axisY);
  });
  ctx.textAlign = "left";

  // Cyber CRT Scanline Overlay inside the Visualizer Stage
  ctx.save();
  ctx.beginPath();
  ctx.rect(vizX, vizY, vizWidth, vizHeight);
  ctx.clip();
  ctx.fillStyle = "rgba(0, 0, 0, 0.22)";
  for (let sy = vizY; sy < vizY + vizHeight; sy += 4) {
    ctx.fillRect(vizX, sy, vizWidth, 1.5);
  }
  const sweepY = vizY + ((nowMs * 0.08 * tempoScale) % vizHeight);
  const sweepGrad = ctx.createLinearGradient(0, sweepY - 18, 0, sweepY + 18);
  sweepGrad.addColorStop(0, "transparent");
  sweepGrad.addColorStop(0.5, palette.bgRgba);
  sweepGrad.addColorStop(1, "transparent");
  ctx.fillStyle = sweepGrad;
  ctx.fillRect(vizX, sweepY - 18, vizWidth, 36);
  ctx.restore();

  // 5. Frequency band telemetry meters below visualizer
  const meterY = vizY + vizHeight + 22;
  const meterColW = (contentWidth - 40) / 3;

  const meters = [
    { label: "SUB-BASS (20–120Hz)", val: bassLevel },
    { label: "MIDRANGE (120Hz–4kHz)", val: midLevel },
    { label: "HIGHS / AIR (4–16kHz)", val: trebleLevel },
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

    ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
    ctx.fillRect(mx, meterY + 18, meterColW, 8);

    ctx.fillStyle = palette.primary;
    ctx.fillRect(mx, meterY + 18, Math.max(4, meterColW * m.val), 8);
  });

  // 6. OutLawZ Bottom Branding & Watermark
  const brandY = height - 66;
  ctx.font = "bold 20px 'Orbitron', sans-serif";
  ctx.fillStyle = palette.primary;
  ctx.fillText("OutLawZ™", margin + 10, brandY);

  ctx.font = "14px 'Share Tech Mono', monospace";
  ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
  ctx.fillText("// BE THE NAME · FULL HD 1080P RECORDING CORE", margin + 140, brandY + 4);

  // 7. Video Recording Live Overlay Indicator (Top Right)
  if (recording) {
    const isFlash = Math.floor(nowMs / 400) % 2 === 0;
    const recBoxW = 280;
    const recBoxH = 46;
    const recX = width - margin - recBoxW;
    const recY = margin + 18;

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

    const totalSec = Math.floor(recordElapsedMs / 1000);
    const mm = String(Math.floor(totalSec / 60)).padStart(2, "0");
    const ss = String(totalSec % 60).padStart(2, "0");
    ctx.font = "bold 15px 'Share Tech Mono', monospace";
    ctx.fillStyle = "#ffffff";
    ctx.fillText(`${mm}:${ss}`, recX + 160, recY + 15);

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
