# AI Music Match Integration - Testing & Acceptance Guide

## ✅ Implementation Complete

All backend and frontend components for end-to-end AI Music Match integration are now implemented and ready for testing.

---

## What's Been Implemented

### Backend
✅ `/music/analyze-audio` - Audio detection and speech detection from transcripts
✅ `/music/add-to-video` - Music mixing with 3 audio modes
✅ Audio analysis data: codec, channels, sample rate, bitrate, duration
✅ Speech detection from transcript segments
✅ 3 audio mixing modes:
  - `keep_original` - No mixing
  - `mix_background_music` - Blend underneath original (with auto-volume reduction if speech)
  - `replace_audio` - Remove original, use music only
✅ Fade in/out effects
✅ Music trimming/looping to match video duration
✅ Version management (edited_music_v1.mp4, v2.mp4, etc.)

### Frontend
✅ Audio status display showing audio_detected, speech_detected, audio_duration
✅ Audio warnings displayed inline
✅ Audio mode selector (Keep Original / Mix Background / Replace Audio)
✅ Volume sliders for mix mode (music_volume, original_volume)
✅ Proper track selection with visual state
✅ Shared audio preview player (single HTMLAudioElement)
✅ "Add Music To Video" button wired to /music/add-to-video endpoint
✅ Proper error handling with visible error messages
✅ Success state with download link
✅ Version history updated after success
✅ Detailed console logging for debugging

### Debugging & Logging
✅ Console logs for:
  - Track selection
  - Audio analysis
  - Audio mode changes
  - Volume slider changes
  - Music mixing requests
  - API responses
  - Output file information

---

## Acceptance Test Steps

### Setup
1. Start the FastAPI backend: `python -m uvicorn main:app --reload --port 8000`
2. Open the frontend in browser
3. Ensure backend status shows "live" (green dot in top bar)

### Test Flow

#### Step 1: Upload Video
1. Click "Video Analyzer" tab
2. Click upload area, select any MP4/MOV video (30-60 seconds recommended)
3. Video should appear as "Ready"
4. Select target platform (Instagram, TikTok, YouTube, etc.)
5. Click "Generate AI Edit Suggestions"
6. Wait for AI analysis to complete

**Expected Result:**
- Metadata extracted (duration, resolution, aspect ratio, FPS, audio status)
- Transcript preview shown (if audio detected)
- AI score breakdown displayed

#### Step 2: Apply Auto Edit
1. Scroll down to "AI Edit Suggestions"
2. Click "Apply Current Suggestions" or auto-edit button
3. Wait for rendering to complete

**Expected Result:**
- New edited version created and rendered
- Video preview updated
- editStudioState.videoId set (can check console)

#### Step 3: Open AI Music Match
1. Scroll to "AI Music Match" section
2. See "Detected Mood" with confidence percentage
3. See "Jamendo tags" field

**Expected Result:**
- Mood auto-detected from transcript
- Confidence shown (0-100%)
- Ready to find music

#### Step 4: Find Music Tracks
1. Optionally select manual mood override from dropdown
2. Click "Find Music" button
3. Wait for Jamendo API call

**Expected Result:**
- 8 music tracks loaded from Jamendo
- Each track shows title, artist, duration, album
- Preview button available for each track
- "Select" button available for each track
- Audio warnings displayed (if any)

**Debugging Tips:**
- Check console for "[Music Match] Results:" log
- Verify Jamendo API key is configured in `.env`
- Check backend logs if tracks not returned

#### Step 5: Audio Analysis
1. After finding music, audio analysis runs automatically
2. Check the "Audio Analysis" section below the controls

**Expected Result:**
- "Audio detected" shows ✓ Yes or ✗ No
- "Speech detected" shows ✓ Yes or ✗ No (based on transcript)
- Audio duration shown
- Any warnings displayed in yellow boxes

**Debugging Tips:**
- Check console for "[Audio Analysis] Results:" log
- Check console for audio codec, channels, sample rate
- Verify ffprobe is installed on system

#### Step 6: Preview Music Track
1. Click "🎧 Preview" button on any track
2. Shared audio player appears at bottom of page
3. Music should play

**Expected Result:**
- Single shared audio player visible
- Track plays from preview URL
- Can pause, adjust volume, seek
- Only one track plays at a time (previous stops)

**Debugging Tips:**
- Check console for "[Music Match] Playing preview:" log
- Check browser console for audio playback errors
- Verify preview URL is valid (CORS might block some URLs)

#### Step 7: Select Track & Audio Mode
1. Click "Select" on a track to select it
2. Button changes to "✓ Selected"
3. Track card highlighted with teal border
4. Audio Mode Selector appears below the grid

**Expected Result:**
- Selected track state persistent
- Selector shows three modes:
  - Keep Original Audio (default selection for reference)
  - Add Background Music (default for mixing)
  - Replace Original Audio
- If speech detected, shows note about music volume being reduced in mix mode

**Debugging Tips:**
- Check console for "[Music Match] Track selected:" log
- Verify selected track data is stored in musicMatchState

#### Step 8: Configure Audio Mode
1. Try each audio mode by clicking radio buttons
2. For "Add Background Music" mode:
   - Two sliders appear below
   - "Music Volume" (default 0.18)
   - "Original Audio Volume" (default 1.0)
3. Adjust sliders
4. Values update in real-time

**Expected Result:**
- Audio mode radio selection works
- Volume controls only visible for "Add Background Music" mode
- Slider values update display text
- Current selections logged to console

**Debugging Tips:**
- Check console for "[Music Match] Audio mode changed to:" log
- Check console for "[Music Match] Music volume set to:" logs

#### Step 9: Add Music To Video
1. Click "➕ Add Music To Video" button (green, should be enabled)
2. Loading state shows "⏳ Adding music..."
3. Wait for backend to:
   - Download music from Jamendo
   - Probe video duration
   - Prepare music (trim/loop/fade)
   - Mix audio with FFmpeg
   - Export new MP4 with version number

**Expected Result:**
- Success message displayed with:
  - Track title and artist
  - Selected audio mode
  - Output filename (e.g., edited_music_v1.mp4)
  - "📥 Download" button
  - Any warnings displayed
- New file created: edited_music_v1.mp4, v2.mp4, etc.
- Video preview updated to new version

**Debugging Tips:**
- Check console for "[Add Music] Payload:" log
- Check console for "[Add Music] Response:" log
- Check backend logs for FFmpeg execution
- Verify .env has JAMENDO_CLIENT_ID configured
- Verify FFmpeg/ffprobe installed (`ffprobe -version`)

#### Step 10: Verify Version History
1. Look at version history list (if shown in UI)
2. New music version should appear
3. editStudioState.versionHistory should include new file

**Expected Result:**
- Version history updated with music version
- Latest version selected and previewed
- Download link functional

#### Step 11: Download & Verify
1. Click "📥 Download" button in success state
2. Or use download link to get edited_music_vN.mp4
3. Download video to computer

**Expected Result:**
- MP4 file downloads successfully
- File has music mixed (depending on selected mode):
  - keep_original: Original audio only
  - mix_background_music: Original + music blended
  - replace_audio: Music only
- Video plays in media player

**Debugging Tips:**
- Check file size (should be >10MB for typical videos)
- Verify audio with: `ffprobe -v error -select_streams a -show_entries stream=codec_name,sample_rate edited_music_v1.mp4`

---

## Error Scenarios & Recovery

### Error: "Apply Auto Edit first"
**Cause:** No video processed yet
**Fix:** Complete Steps 1-2 first

### Error: "Select a music track first"
**Cause:** No track selected
**Fix:** Complete Step 7

### Error: "Music mixing requires backend to be live"
**Cause:** Backend not running or crashed
**Fix:** 
1. Check if `uvicorn main:app` is running
2. Check backend logs for errors
3. Restart backend server

### Error: "Jamendo API key not configured"
**Cause:** JAMENDO_CLIENT_ID not set in .env
**Fix:**
1. Get API key from https://www.jamendo.com/en/api/console
2. Add to .env: `JAMENDO_CLIENT_ID=your_key_here`
3. Restart backend

### Error: "Audio preview could not be played"
**Cause:** CORS blocked or invalid URL
**Fix:**
1. Check browser console for CORS errors
2. Verify preview URL is valid
3. Try different track (different audio format)

### Error: "FFmpeg not found" (in backend logs)
**Cause:** FFmpeg/ffprobe not installed
**Fix:**
1. Install FFmpeg: 
   - macOS: `brew install ffmpeg`
   - Windows: Download from ffmpeg.org or `choco install ffmpeg`
   - Linux: `sudo apt-get install ffmpeg`
2. Verify: `ffmpeg -version` and `ffprobe -version`
3. Restart backend

### Error: "Music download timed out"
**Cause:** Network issue or Jamendo URL slow
**Fix:**
1. Check network connectivity
2. Try different track
3. Increase timeout in music_mixer.py if needed

### Silent Failure - No Output Video
**Symptoms:** Success message shown but file not created
**Debugging:**
1. Check backend logs for FFmpeg errors
2. Check edited_versions folder exists: `backend/edited_versions/{video_id}/`
3. Verify video_id is correct (check console logs)
4. Try with different video format

---

## Console Debugging Quick Reference

### Key Logs to Check
```javascript
// In browser console, look for these logs:
[Music Match] Track selected: "Track Title"
[Audio Analysis] Results: { audio_detected: true, ... }
[Audio Analysis] Updated state - Audio detected: true Speech detected: false
[Music Match] Audio mode changed to: mix_background_music
[Music Match] Music volume set to: 0.18
[Add Music] Payload: { videoId: "...", trackTitle: "..." }
[Add Music] Response: { success: true, output_filename: "..." }
```

### Backend Logs to Check
```python
# In terminal running uvicorn, look for:
POST /music/analyze-audio
POST /music/add-to-video
# And check for errors or FFmpeg execution messages
```

---

## Performance Notes

### Expected Timing
- Music finding: 2-5 seconds
- Audio analysis: <1 second
- Music download: 5-15 seconds (depends on file size)
- Music mixing (FFmpeg): 10-60 seconds (depends on video length)

### File Sizes
- Original video: Variable
- Music mixed video: Usually ~10-30MB (MP4 at 1280x720 or 1920x1080)
- Temporary files: Cleaned up automatically

---

## Success Criteria Checklist

- [ ] Upload video successfully
- [ ] Apply auto edit creates version file
- [ ] Audio analysis detects audio presence
- [ ] Speech detection works (if transcript available)
- [ ] Mood auto-detected with confidence
- [ ] Music tracks load from Jamendo (8 tracks)
- [ ] Audio preview plays in shared player
- [ ] Track selection works with visual feedback
- [ ] Audio mode selector shows three options
- [ ] Volume sliders work for mix mode
- [ ] "Add Music To Video" button enabled when conditions met
- [ ] Music mixing completes without error
- [ ] Success message shows with filename
- [ ] Download link generates correct file
- [ ] Downloaded MP4 contains selected music
- [ ] Version history updates with new file
- [ ] No breaking changes to existing features:
  - [ ] AI Suggestions still work
  - [ ] Auto Edit still works
  - [ ] Edit Studio still works
  - [ ] Version History still works
  - [ ] Publishing still works

---

## Next Steps After Acceptance

1. **Design Feedback**: Polish UI based on feedback
2. **Performance**: Profile FFmpeg mixing, optimize if needed
3. **Expansion**: Add more audio modes (crossfade, ducking, etc.)
4. **AI Music**: Integrate AI-generated music providers
5. **Batch Processing**: Support multiple music additions
6. **Analytics**: Track music selection patterns

---

## Support & Questions

### Common Issues
- Check browser console (F12) for JavaScript errors
- Check backend terminal for Python/FFmpeg errors
- Verify all .env variables are set correctly
- Ensure video files are in supported format (MP4, MOV, AVI)

### Logs Location
- Frontend: Browser Developer Tools → Console tab
- Backend: Terminal where `uvicorn main:app` runs

---

## Acceptance Sign-Off

**Tester Name:** _________________
**Date:** _________________
**Backend Version:** Ready
**Frontend Version:** Ready
**All Tests Passed:** ☐ Yes / ☐ No

**Notes:**

_________________________________________________________________

_________________________________________________________________

_________________________________________________________________
