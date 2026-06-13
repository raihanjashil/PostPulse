# Audio Detection & Music Mixing Frontend Integration Guide

## Overview

The backend now provides two new endpoints for audio analysis and music mixing:

1. **POST `/music/analyze-audio`** - Analyze audio properties of a video
2. **POST `/music/add-to-video`** - Add selected Jamendo music to video with multiple audio modes

This document provides the API contracts and frontend integration examples.

---

## API Endpoints

### 1. Audio Analysis Endpoint

**POST `/music/analyze-audio`**

Analyzes audio properties of a video, detects speech from transcript, and returns audio status.

#### Request

```json
{
  "video_id": "string - required, the ID of the video",
  "transcript": {
    "available": boolean,
    "segments": [
      { "text": "string", "start": 0.0, "end": 1.5 }
    ]
  }
}
```

#### Response (Success)

```json
{
  "video_id": "string",
  "audio_detected": boolean,
  "audio_codec": "string | null",
  "audio_channels": integer,
  "sample_rate": integer,
  "audio_bitrate": integer,
  "audio_duration": float,
  "audio_loudness": float | null,
  "speech_detected": boolean,
  "music_detected": null,
  "warnings": ["string"]
}
```

#### Response (Error)

Returns 404 if video not found, otherwise 400 with error detail.

#### Example Usage

```javascript
async function analyzeVideoAudio(videoId, transcript) {
  const response = await fetch('http://localhost:8000/music/analyze-audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_id: videoId,
      transcript: transcript
    })
  });
  
  if (!response.ok) {
    throw new Error(`Audio analysis failed: ${response.statusText}`);
  }
  
  const data = await response.json();
  console.log(`Audio detected: ${data.audio_detected}`);
  console.log(`Speech detected: ${data.speech_detected}`);
  console.log(`Warnings: ${data.warnings.join(', ')}`);
  
  return data;
}
```

---

### 2. Music Mixing Endpoint

**POST `/music/add-to-video`**

Adds selected Jamendo music to a video with configurable mixing options.

#### Request

```json
{
  "video_id": "string - required",
  "track": {
    "id": "string",
    "title": "string",
    "artist": "string",
    "preview_audio_url": "string",
    "download_url": "string",
    "speech_detected": boolean - optional, set based on audio analysis
  },
  "audio_url": "string - optional override for audio URL",
  "audio_mode": "string - one of: keep_original, mix_background_music, replace_audio",
  "music_volume": float - default 0.18, range 0.0-1.0,
  "original_volume": float - default 1.0, range 0.0-1.0,
  "fade_in_seconds": float - default 1.0,
  "fade_out_seconds": float - default 1.5
}
```

#### Audio Modes

- **keep_original**: No music added. Original audio preserved. Returns immediately without mixing.
- **mix_background_music**: Mix selected music underneath original audio. If speech detected, music volume is automatically lowered (capped at 0.18).
- **replace_audio**: Remove original audio, replace with selected music only.

#### Response (Success)

```json
{
  "success": true,
  "video_id": "string",
  "output_path": "string - full file path",
  "output_url": "string - download URL",
  "output_filename": "string - e.g. edited_music_v1.mp4",
  "audio_mode": "string",
  "audio_preserved": boolean,
  "music_added": boolean,
  "track_title": "string",
  "track_artist": "string",
  "video_duration_seconds": float,
  "warnings": ["string"],
  "version_history": ["string"]
}
```

#### Example Usage

```javascript
async function addMusicToVideo(videoId, selectedTrack, audioAnalysis) {
  // Determine audio mode based on user selection
  const audioMode = document.querySelector('input[name="audio-mode"]:checked')?.value 
    || 'mix_background_music';
  
  const response = await fetch('http://localhost:8000/music/add-to-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_id: videoId,
      track: {
        ...selectedTrack,
        speech_detected: audioAnalysis.speech_detected
      },
      audio_mode: audioMode,
      music_volume: parseFloat(document.getElementById('music-volume')?.value || 0.18),
      original_volume: parseFloat(document.getElementById('original-volume')?.value || 1.0),
      fade_in_seconds: 1.0,
      fade_out_seconds: 1.5
    })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || 'Music mixing failed');
  }
  
  const result = await response.json();
  console.log(`Music added: ${result.music_added}`);
  console.log(`Output: ${result.output_filename}`);
  
  return result;
}
```

---

## Frontend UI Integration

### 1. Audio Status Display

After analyzing a video, show the audio detection status to the user:

```html
<div id="audio-status" class="audio-status">
  <div class="status-row">
    <span class="label">Audio detected:</span>
    <span id="audio-detected-status" class="value">—</span>
  </div>
  <div class="status-row">
    <span class="label">Speech detected:</span>
    <span id="speech-detected-status" class="value">—</span>
  </div>
  <div class="status-row">
    <span class="label">Audio duration:</span>
    <span id="audio-duration-status" class="value">—</span>
  </div>
  <div id="audio-warnings" class="warnings hidden">
    <!-- Warnings rendered here -->
  </div>
</div>
```

#### JavaScript Example

```javascript
function displayAudioStatus(audioAnalysis) {
  const audioDetected = document.getElementById('audio-detected-status');
  const speechDetected = document.getElementById('speech-detected-status');
  const audioDuration = document.getElementById('audio-duration-status');
  const warnings = document.getElementById('audio-warnings');
  
  audioDetected.textContent = audioAnalysis.audio_detected ? '✓ Yes' : '✗ No';
  audioDetected.className = audioAnalysis.audio_detected ? 'value yes' : 'value no';
  
  speechDetected.textContent = audioAnalysis.speech_detected ? '✓ Yes' : '✗ No';
  speechDetected.className = audioAnalysis.speech_detected ? 'value yes' : 'value no';
  
  if (audioAnalysis.audio_duration > 0) {
    const mins = Math.floor(audioAnalysis.audio_duration / 60);
    const secs = Math.floor(audioAnalysis.audio_duration % 60);
    audioDuration.textContent = `${mins}m ${secs}s`;
  }
  
  // Display warnings
  if (audioAnalysis.warnings.length > 0) {
    warnings.innerHTML = audioAnalysis.warnings
      .map(w => `<div class="warning-item">⚠️ ${w}</div>`)
      .join('');
    warnings.classList.remove('hidden');
  } else {
    warnings.classList.add('hidden');
  }
}
```

### 2. Audio Mode Selector

In the "Add Music to Video" section, after user selects a track:

```html
<div id="audio-mode-selector" class="audio-mode-selector">
  <label class="mode-label">How to add music?</label>
  
  <div class="mode-option">
    <input type="radio" name="audio-mode" value="keep_original" id="mode-keep">
    <label for="mode-keep">
      <span class="mode-title">Keep Original Audio</span>
      <span class="mode-desc">Original audio is preserved. No music added.</span>
    </label>
  </div>
  
  <div class="mode-option">
    <input type="radio" name="audio-mode" value="mix_background_music" id="mode-mix" checked>
    <label for="mode-mix">
      <span class="mode-title">Add Background Music</span>
      <span class="mode-desc">Mix selected music underneath original audio. Music will be at low volume if speech detected.</span>
    </label>
    
    <div id="mix-controls" class="mix-controls">
      <div class="control-group">
        <label for="music-volume">Music Volume:</label>
        <input type="range" id="music-volume" min="0" max="1" step="0.05" value="0.18">
        <span id="music-volume-display">0.18</span>
      </div>
      <div class="control-group">
        <label for="original-volume">Original Audio Volume:</label>
        <input type="range" id="original-volume" min="0" max="1" step="0.05" value="1.0">
        <span id="original-volume-display">1.0</span>
      </div>
    </div>
  </div>
  
  <div class="mode-option">
    <input type="radio" name="audio-mode" value="replace_audio" id="mode-replace">
    <label for="mode-replace">
      <span class="mode-title">Replace Original Audio</span>
      <span class="mode-desc">Remove original audio, use selected music only.</span>
    </label>
  </div>
</div>
```

#### JavaScript

```javascript
function initAudioModeSelector() {
  const radios = document.querySelectorAll('input[name="audio-mode"]');
  const mixControls = document.getElementById('mix-controls');
  const musicVolumeSlider = document.getElementById('music-volume');
  const musicVolumeDisplay = document.getElementById('music-volume-display');
  const originalVolumeSlider = document.getElementById('original-volume');
  const originalVolumeDisplay = document.getElementById('original-volume-display');
  
  radios.forEach(radio => {
    radio.addEventListener('change', () => {
      if (radio.value === 'mix_background_music') {
        mixControls.classList.remove('hidden');
      } else {
        mixControls.classList.add('hidden');
      }
    });
  });
  
  musicVolumeSlider.addEventListener('input', (e) => {
    musicVolumeDisplay.textContent = parseFloat(e.target.value).toFixed(2);
  });
  
  originalVolumeSlider.addEventListener('input', (e) => {
    originalVolumeDisplay.textContent = parseFloat(e.target.value).toFixed(2);
  });
}
```

### 3. Add Music Button & Result Display

In the Music Match section, after track selection:

```html
<div id="music-match-section">
  <!-- Existing mood/track recommendation UI -->
  
  <div id="selected-track-info" class="selected-track-info hidden">
    <div class="track-card">
      <div class="track-header">
        <span class="track-title" id="selected-track-title">—</span>
        <span class="track-artist" id="selected-track-artist">—</span>
      </div>
      <audio id="track-preview" controls style="width: 100%; margin: 12px 0;"></audio>
    </div>
    
    <!-- Audio Mode Selector (from above) -->
    <div id="audio-mode-selector" class="audio-mode-selector"></div>
    
    <!-- Add Music Button -->
    <button id="btn-add-music" class="btn-primary" style="width: 100%; margin: 16px 0;">
      <span class="btn-icon">🎵</span> Add Music To Video
    </button>
    
    <!-- Result -->
    <div id="music-result" class="music-result hidden">
      <div id="music-result-content"></div>
    </div>
  </div>
</div>
```

#### JavaScript

```javascript
async function handleAddMusic(videoId, selectedTrack, audioAnalysis) {
  const btn = document.getElementById('btn-add-music');
  const resultDiv = document.getElementById('music-result');
  const resultContent = document.getElementById('music-result-content');
  
  btn.disabled = true;
  btn.textContent = '⏳ Adding music...';
  resultDiv.classList.add('hidden');
  
  try {
    const result = await addMusicToVideo(videoId, selectedTrack, audioAnalysis);
    
    if (result.success) {
      resultContent.innerHTML = `
        <div class="success-message">
          <h3>✓ Music Added Successfully</h3>
          <p>
            <strong>${result.track_title}</strong> by ${result.track_artist}<br>
            Mode: ${result.audio_mode.replace(/_/g, ' ')}<br>
            Video: ${result.output_filename}
          </p>
          <div class="result-actions">
            <a href="${result.output_url}" class="btn-secondary" download>📥 Download Video</a>
            <button class="btn-secondary" onclick="addToVersionHistory('${result.output_filename}')">
              ➕ Add to Version History
            </button>
          </div>
          ${result.warnings.length > 0 ? `
            <div class="warnings">
              ${result.warnings.map(w => `<div class="warning-item">⚠️ ${w}</div>`).join('')}
            </div>
          ` : ''}
        </div>
      `;
      resultDiv.classList.remove('hidden');
    } else {
      throw new Error(result.warnings?.[0] || 'Unknown error');
    }
  } catch (error) {
    resultContent.innerHTML = `
      <div class="error-message">
        <h3>✗ Error Adding Music</h3>
        <p>${error.message}</p>
      </div>
    `;
    resultDiv.classList.remove('hidden');
  } finally {
    btn.disabled = false;
    btn.textContent = '🎵 Add Music To Video';
  }
}

// Wire up the button
document.getElementById('btn-add-music')?.addEventListener('click', async () => {
  const videoId = state.currentVideoId; // Set by upload/analyzer
  const selectedTrack = state.selectedTrack; // Set when user clicks a track
  const audioAnalysis = state.audioAnalysis; // Set by /music/analyze-audio
  
  if (!videoId || !selectedTrack || !audioAnalysis) {
    alert('Please upload a video, get audio analysis, and select a track first.');
    return;
  }
  
  await handleAddMusic(videoId, selectedTrack, audioAnalysis);
});
```

---

## Integration Flow

### Step 1: Upload Video & Get Audio Analysis

```javascript
async function onVideoUploaded(videoId, transcript) {
  // Store video ID in state
  state.currentVideoId = videoId;
  
  // Get audio analysis
  const audioAnalysis = await analyzeVideoAudio(videoId, transcript);
  state.audioAnalysis = audioAnalysis;
  
  // Display audio status
  displayAudioStatus(audioAnalysis);
  
  // Show music recommendation section
  document.getElementById('music-match-section').classList.remove('hidden');
}
```

### Step 2: Get Music Recommendations

```javascript
async function getMusic Recommendations(transcript, metadata) {
  const response = await fetch('http://localhost:8000/music/recommend', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: transcript,
      metadata: metadata,
      target_platform: state.targetPlatform || 'instagram'
    })
  });
  
  const result = await response.json();
  
  // Display tracks
  result.tracks.forEach(track => {
    const trackEl = createTrackElement(track);
    trackEl.addEventListener('click', () => {
      state.selectedTrack = track;
      displaySelectedTrack(track);
    });
  });
}
```

### Step 3: User Selects Track & Audio Mode

The UI should show:
1. Selected track with preview
2. Audio detection status (from step 1)
3. Audio mode selector
4. "Add Music To Video" button

### Step 4: Add Music

User clicks "Add Music To Video" → calls `/music/add-to-video` → download or add to version history.

---

## Error Handling

### FFmpeg Not Installed

If ffprobe is missing, audio analysis returns a warning:

```
"FFmpeg/ffprobe not installed or not on PATH. Audio detection unavailable. Install FFmpeg to enable audio analysis."
```

The UI should:
- Still allow user to proceed with music mixing
- Warn that audio properties cannot be detected
- Suggest installing FFmpeg

### Music Download Failures

If Jamendo URL is invalid or download fails:

```json
{
  "success": false,
  "warnings": [
    "Invalid URL scheme: ftp. Must be http or https.",
    "Music download failed: Connection timeout"
  ]
}
```

The UI should:
- Show the error to the user
- Allow retry
- Suggest checking Jamendo credentials

### Video Not Found

If video_id doesn't exist:

```
HTTP 404: "No video found for video_id: abc123"
```

The UI should:
- Redirect to upload
- Show clear error message

---

## CSS Classes Reference

```css
/* Audio Status */
.audio-status { /* Container for audio analysis display */ }
.status-row { /* Each row (Audio detected, Speech detected, etc) */ }
.status-row .label { /* Left side label */ }
.status-row .value { /* Right side value */ }
.value.yes { /* For true values, show green */ }
.value.no { /* For false values, show red */ }
.warnings { /* Container for warning messages */ }
.warning-item { /* Each warning */ }

/* Audio Mode Selector */
.audio-mode-selector { /* Main container */ }
.mode-label { /* "How to add music?" label */ }
.mode-option { /* Each radio option */ }
.mode-title { /* Option title */ }
.mode-desc { /* Option description */ }
.mix-controls { /* Volume sliders for mix mode */ }
.control-group { /* Each slider control */ }

/* Music Matching */
.selected-track-info { /* Container for selected track */ }
.track-card { /* Track display */ }
.track-header { /* Track title/artist */ }
.track-title { /* Track name */ }
.track-artist { /* Artist name */ }
#track-preview { /* Audio preview element */ }

/* Results */
.music-result { /* Result container */ }
.success-message { /* Success state */ }
.error-message { /* Error state */ }
.result-actions { /* Buttons after success */ }
```

---

## Testing Checklist

- [ ] Upload video → Audio analysis returns correct status
- [ ] Audio analysis includes speech detection from transcript
- [ ] If FFmpeg missing → Warning displayed but UI doesn't break
- [ ] Select Jamendo track → Shows audio mode selector
- [ ] Select "Keep Original" → Returns immediately, no mixing
- [ ] Select "Mix Background Music" → Music mixed at correct volumes
- [ ] Select "Replace Audio" → Original audio removed, music only
- [ ] Speech detected → Music volume auto-reduced in mix mode
- [ ] Download/preview links work
- [ ] Version history updated after music mixing
- [ ] All warnings displayed to user
- [ ] Error handling graceful (no white screens)

---

## Backend Status

✅ Audio detection with ffprobe
✅ Speech detection from transcript
✅ Music download with validation
✅ Music trimming/looping to video duration
✅ Fade in/out effects
✅ FFmpeg-based audio mixing (3 modes)
✅ Version management
✅ Error handling & warnings

Ready for frontend integration!
