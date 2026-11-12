# Massive Radio Recorder — Audio Stabilization & YouTube Video Recorder

A high-performance, dark cyberpunk browser radio player, direct audio stream capturer, and Full HD (1920×1080 60 FPS) YouTube-style video recorder built with React 19, TypeScript, Web Audio API, Canvas 2D, MediaRecorder, and IndexedDB.

---

## Features

### 1. High-Fidelity Radio Streaming & Direct Audio Recording
- **Live Icecast MP3 Streaming**: Real-time streaming for curated electronic and synth stations with continuous track metadata parsing.
- **Direct-to-Disk Recording**: Leverages the File System Access API (`showSaveFilePicker`) to stream incoming MP3 audio chunks straight to the local hard drive with near-zero memory footprint.
- **In-Memory Capture Fallback**: Full browser-fallback recording using chunked `Uint8Array` buffers and client-side `Blob` packaging for browsers without direct file picker access.
- **Accurate Time-Tracking**: Recording duration timestamps are initialized strictly upon receiving the first audio data packet, preventing network connection latency from skewing take lengths.
- **Timed Auto-Stop**: Integrated limiter timers (15m, 30m, 1h, 2h, and Manual).

### 2. YouTube-Style 16:9 Full HD Video Recorder
- **1080p Master Canvas Composition**: 1920×1080 fixed backing canvas resolution captured at 60 FPS via `canvas.captureStream(60)`.
- **Rotating Vinyl Disc Presentation**:
  - 640px diameter realistic vinyl record with microgrooves, metallic spindle hole, and light reflections.
  - Dynamically rotates during live playback (~33 RPM) and **pauses rotation when audio stops or is paused**.
  - Embedded into the 1080p canvas composition so it renders directly into the output video file.
- **Artwork Priority Cascade**:
  1. **Custom User Upload**: Directly upload any image (JPG/PNG/WebP) via the "Upload Art" file picker.
  2. **Automatic Artwork Lookup**: Live track queries to the iTunes Search API returning high-res 600×600 album artwork with in-memory caching.
  3. **OutLawZ Cyberpunk Fallback**: Procedurally drawn glowing circuit rings, metallic branding, and neon typography.
- **Live Reactive Audio Visualizers**:
  - **Spectrum**: Multi-band equalizer with floating peak markers and 3-color frequency gradients.
  - **Laser Wave**: Oscilloscope waveform with neon glow bloom.
  - **Reactor Radar**: Concentric tactical cyber radar with radial energy spokes.
- **Dynamic Track Typography & HUD**: Real-time display of track title, artist name, station name, stream bitrate, and peak dBFS.
- **YouTube Track Search**: Quick action button opening direct YouTube search queries for the currently playing track.

### 3. Local Vault & Disposition Management
- **IndexedDB Tape Archive**: Offline storage of recorded audio (`audio/mpeg`) and video (`video/webm` or `video/mp4`) takes.
- **Inline Video Player**: Preview recorded 1080p videos directly in the browser before exporting or from the archive vault.
- **Cue Sheet Export**: Generates `.txt` track logs with relative timestamps for all tracks announced during the recording session.

---

## Technical Specifications

| Parameter | Audio Recording | Video Recording |
|---|---|---|
| **Format** | MP3 (`audio/mpeg`) | WebM / MP4 (`video/webm;codecs=vp9,opus`) |
| **Resolution** | Audio only | 1920×1080 (16:9 Full HD) |
| **Frame Rate** | N/A | 60 FPS |
| **Bitrate** | 192–320 kbps (Stream Native) | 6.0 Mbps Target Video Bitrate |
| **Audio Sync** | Direct Stream Chunks | Web Audio `MediaStreamAudioDestinationNode` |
| **Disk Sinking** | File System Access API (`showSaveFilePicker`) | In-memory `MediaRecorder` chunk blob |
| **Persistence** | IndexedDB (`massive-tape` DB) | IndexedDB (`massive-tape` DB) |

---

## Stream & CORS Architecture

The Web Audio API and `canvas.captureStream()` require audio and image elements to be CORS-accessible:
1. **Audio Streams**: External station streams must supply `Access-Control-Allow-Origin: *`. HTMLAudioElement uses `crossOrigin = "anonymous"` to prevent canvas tainting when routing through `createMediaElementSource`.
2. **Artwork Images**: Automatic album artwork fetched from Apple's CDN provides `Access-Control-Allow-Origin: *`, allowing safe `drawImage()` calls onto the 1080p canvas without security errors.
3. **CORS Guard**: If an audio stream blocks JavaScript fetch access, playback can still occur via the native audio tag while recording alerts the user with clear diagnostics.

---

## Installation & Running

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build production bundle
npm run build
```

---

## Key Files

- `src/components/deck.tsx`: Master cyber HUD player, visualizer controller, and recorder interface.
- `src/lib/video-composition.ts`: 1920×1080 16:9 canvas renderer with rotating vinyl disc and audio visualizer.
- `src/lib/artwork.ts`: Track metadata parser, iTunes artwork search, and caching engine.
- `src/lib/capture.ts`: Stream fetcher, direct file system writer, and connection delay compensation.
- `src/lib/stations.ts`: Station definitions, bitrate info, and status fetcher with timeout guards.
- `src/lib/library.ts`: IndexedDB storage for audio and video takes.
