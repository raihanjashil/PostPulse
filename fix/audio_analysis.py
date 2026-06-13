"""
Audio analysis module for detecting audio, speech, and music properties in videos.

Uses ffprobe for reliable audio stream detection and metadata extraction.
Speech detection based on transcript availability.
Music detection is a placeholder (not yet implemented).
"""

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional


def probe_audio(video_path: str | Path) -> dict[str, Any]:
    """
    Probe a video file using ffprobe to extract audio stream information.
    
    Returns audio analysis with the following fields:
    - audio_detected: bool - whether an audio stream was found
    - audio_codec: str - codec name (e.g., "aac", "mp3")
    - audio_duration: float - duration in seconds
    - audio_channels: int - number of channels (1=mono, 2=stereo)
    - sample_rate: int - samples per second (e.g., 48000)
    - audio_bitrate: int - bitrate in bps (e.g., 128000)
    - audio_loudness: Optional[float] - LUFS loudness (placeholder: None)
    - warnings: list[str] - any warnings or notes
    """
    video_path = Path(video_path)
    audio_info = {
        "audio_detected": False,
        "audio_codec": None,
        "audio_duration": 0.0,
        "audio_channels": 0,
        "sample_rate": 0,
        "audio_bitrate": 0,
        "audio_loudness": None,
        "warnings": [],
    }
    
    ffprobe = _resolve_ffprobe_executable()
    if not ffprobe:
        audio_info["warnings"].append(
            "FFmpeg/ffprobe not installed or not on PATH. "
            "Audio detection unavailable. Install FFmpeg to enable audio analysis."
        )
        return audio_info
    
    try:
        # Use ffprobe to get audio stream information
        result = subprocess.run(
            [
                ffprobe,
                "-v", "error",
                "-select_streams", "a:0",
                "-show_entries", "stream=codec_name,duration,channels,sample_rate,bit_rate",
                "-of", "json",
                str(video_path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        
        if result.returncode != 0:
            audio_info["warnings"].append(f"ffprobe error: {result.stderr.strip()}")
            return audio_info
        
        # Parse JSON output
        try:
            data = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            audio_info["warnings"].append(f"Failed to parse ffprobe output: {exc}")
            return audio_info
        
        streams = data.get("streams", [])
        if not streams:
            audio_info["warnings"].append("No audio stream found in video.")
            return audio_info
        
        # Extract audio stream information
        stream = streams[0]
        audio_info["audio_detected"] = True
        audio_info["audio_codec"] = stream.get("codec_name", "unknown")
        audio_info["audio_channels"] = stream.get("channels", 0)
        audio_info["sample_rate"] = stream.get("sample_rate", 0)
        
        # Handle duration (may be in stream or format level)
        duration = stream.get("duration")
        if duration:
            try:
                audio_info["audio_duration"] = float(duration)
            except (TypeError, ValueError):
                audio_info["audio_duration"] = 0.0
        
        # Handle bitrate
        bit_rate = stream.get("bit_rate")
        if bit_rate:
            try:
                audio_info["audio_bitrate"] = int(bit_rate)
            except (TypeError, ValueError):
                audio_info["audio_bitrate"] = 0
        
        # Audio loudness detection is not implemented yet
        audio_info["audio_loudness"] = None
        
    except subprocess.TimeoutExpired:
        audio_info["warnings"].append("ffprobe timed out during audio analysis.")
    except Exception as exc:
        audio_info["warnings"].append(f"Audio probe failed: {exc}")
    
    return audio_info


def detect_speech(transcript: dict[str, Any] | None) -> dict[str, Any]:
    """
    Detect if speech is present in the video based on transcript segments.
    
    Returns:
    - speech_detected: bool - True if transcript has text segments
    - segment_count: int - number of transcript segments
    - warnings: list[str] - any warnings
    """
    speech_info = {
        "speech_detected": False,
        "segment_count": 0,
        "warnings": [],
    }
    
    if not transcript or not isinstance(transcript, dict):
        speech_info["warnings"].append("No transcript available for speech detection.")
        return speech_info
    
    if not transcript.get("available"):
        speech_info["warnings"].append("Transcript not available.")
        return speech_info
    
    segments = transcript.get("segments", [])
    if not isinstance(segments, list):
        speech_info["warnings"].append("Transcript segments malformed.")
        return speech_info
    
    # Count non-empty text segments
    text_segments = [s for s in segments if isinstance(s, dict) and s.get("text", "").strip()]
    
    if text_segments:
        speech_info["speech_detected"] = True
        speech_info["segment_count"] = len(text_segments)
    else:
        speech_info["warnings"].append("No text found in transcript segments.")
    
    return speech_info


def detect_music(audio_info: dict[str, Any]) -> dict[str, Any]:
    """
    Placeholder for music detection.
    
    Music detection is not yet implemented.
    This function is reserved for future use with audio classification models.
    
    Returns:
    - music_detected: None - not implemented
    - warnings: list[str] - implementation status warning
    """
    return {
        "music_detected": None,
        "warnings": [
            "Music detection is not implemented yet. "
            "This feature requires audio analysis beyond scope of current implementation."
        ],
    }


def analyze_audio(
    video_path: str | Path,
    transcript: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Comprehensive audio analysis of a video.
    
    Combines audio detection, speech detection, and returns a complete analysis.
    
    Args:
        video_path: Path to video file
        transcript: Optional transcript dict (from AI analysis)
    
    Returns:
        Dictionary with audio_detected, speech_detected, music_detected, audio_duration,
        and combined warnings.
    """
    # Probe audio stream
    audio_probe = probe_audio(video_path)
    
    # Detect speech from transcript
    speech_info = detect_speech(transcript)
    
    # Placeholder for music detection
    music_info = detect_music(audio_probe)
    
    # Combine all information
    all_warnings = []
    all_warnings.extend(audio_probe.get("warnings", []))
    all_warnings.extend(speech_info.get("warnings", []))
    all_warnings.extend(music_info.get("warnings", []))
    
    return {
        "audio_detected": audio_probe["audio_detected"],
        "audio_codec": audio_probe["audio_codec"],
        "audio_channels": audio_probe["audio_channels"],
        "sample_rate": audio_probe["sample_rate"],
        "audio_bitrate": audio_probe["audio_bitrate"],
        "audio_duration": audio_probe["audio_duration"],
        "audio_loudness": audio_probe["audio_loudness"],
        "speech_detected": speech_info["speech_detected"],
        "music_detected": music_info["music_detected"],
        "warnings": _dedupe_preserve_order(all_warnings),
    }


def _resolve_ffprobe_executable() -> str | None:
    """Resolve path to ffprobe executable."""
    ffprobe = shutil.which("ffprobe")
    if ffprobe:
        return ffprobe
    
    try:
        import imageio_ffmpeg
        exe_dir = Path(imageio_ffmpeg.get_ffmpeg_exe()).parent
        ffprobe_path = exe_dir / "ffprobe"
        if ffprobe_path.exists():
            return str(ffprobe_path)
        # On Windows, try with .exe
        ffprobe_path = exe_dir / "ffprobe.exe"
        if ffprobe_path.exists():
            return str(ffprobe_path)
    except Exception:
        pass
    
    return None


def _dedupe_preserve_order(items: list[str]) -> list[str]:
    """Remove duplicates while preserving order."""
    seen = set()
    result = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result
