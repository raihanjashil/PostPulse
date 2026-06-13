"""
Music mixing module for adding downloaded Jamendo tracks to edited videos.

Handles safe music downloading, trimming/looping to match video duration,
fade in/out effects, and FFmpeg-based audio mixing with multiple audio modes:
- keep_original: No music added, original audio preserved
- mix_background_music: Mix selected music underneath original audio
- replace_audio: Replace original audio with selected music
"""

import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse
import requests


def add_music_to_video(
    video_path: str | Path,
    track: dict[str, Any],
    audio_url: str | None = None,
    audio_mode: str = "mix_background_music",
    music_volume: float = 0.18,
    original_volume: float = 1.0,
    fade_in_seconds: float = 1.0,
    fade_out_seconds: float = 1.5,
    speech_detected: bool = False,
    video_id: str = "unknown",
) -> dict[str, Any]:
    """
    Add selected music to a video using FFmpeg.
    
    Args:
        video_path: Path to edited video
        track: Jamendo track dict with 'title', 'artist', 'preview_audio_url' or 'download_url'
        audio_url: Optional override for audio URL
        audio_mode: One of 'keep_original', 'mix_background_music', 'replace_audio'
        music_volume: Volume for mixed music (0.0-1.0)
        original_volume: Volume for original audio (0.0-1.0)
        fade_in_seconds: Fade in duration for music
        fade_out_seconds: Fade out duration for music
        speech_detected: Whether speech was detected in original audio
        video_id: Video ID for versioning
    
    Returns:
        Result dict with success status, output path, warnings, etc.
    """
    video_path = Path(video_path)
    warnings: list[str] = []
    
    # Validate mode
    if audio_mode not in {"keep_original", "mix_background_music", "replace_audio"}:
        return {
            "success": False,
            "audio_mode": audio_mode,
            "warnings": [f"Invalid audio_mode: {audio_mode}. Must be one of: keep_original, mix_background_music, replace_audio"],
        }
    
    # Handle keep_original mode
    if audio_mode == "keep_original":
        return {
            "success": True,
            "output_path": str(video_path),
            "output_url": f"/download/edited-video/{video_id}/{video_path.name}",
            "audio_mode": "keep_original",
            "audio_preserved": True,
            "music_added": False,
            "warnings": ["Original audio kept. No music added."],
        }
    
    # Get audio URL from track or parameter
    music_url = audio_url or track.get("preview_audio_url") or track.get("download_url")
    if not music_url:
        return {
            "success": False,
            "audio_mode": audio_mode,
            "warnings": ["No audio URL available in track or provided."],
        }
    
    # Create temp directory for music files
    with tempfile.TemporaryDirectory(prefix="music_mix_") as temp_dir:
        temp_path = Path(temp_dir)
        
        # Download music track
        music_download_path = temp_path / "music_download.mp3"
        download_result = _download_music_track(music_url, music_download_path)
        if not download_result["success"]:
            return {
                "success": False,
                "audio_mode": audio_mode,
                "warnings": download_result.get("warnings", ["Failed to download music."]),
            }
        
        # Probe video duration
        video_duration = _probe_duration(video_path)
        if video_duration <= 0:
            return {
                "success": False,
                "audio_mode": audio_mode,
                "warnings": ["Could not determine video duration."],
            }
        
        # Prepare music track (trim/loop to match video duration)
        music_prepared_path = temp_path / "music_prepared.aac"
        prepare_result = _prepare_music_track(
            music_path=music_download_path,
            duration_seconds=video_duration,
            output_path=music_prepared_path,
            fade_in_seconds=fade_in_seconds,
            fade_out_seconds=fade_out_seconds,
        )
        if not prepare_result["success"]:
            return {
                "success": False,
                "audio_mode": audio_mode,
                "warnings": prepare_result.get("warnings", ["Failed to prepare music track."]),
            }
        
        warnings.extend(prepare_result.get("warnings", []))
        
        # Adjust music volume if speech detected
        adjusted_music_volume = music_volume
        if speech_detected and audio_mode == "mix_background_music":
            adjusted_music_volume = min(music_volume, 0.18)
            warnings.append(
                f"Speech detected. Music volume adjusted to {adjusted_music_volume:.2f} for clarity."
            )
        
        # Mix music with video based on audio mode
        version_number = _get_next_music_version(video_path)
        output_filename = f"edited_music_v{version_number}.mp4"
        output_path = video_path.parent / output_filename
        
        try:
            if audio_mode == "replace_audio":
                mix_result = _mix_replace_audio(
                    video_path=video_path,
                    music_path=music_prepared_path,
                    output_path=output_path,
                )
                audio_preserved = False
                music_added = True
            else:  # mix_background_music
                mix_result = _mix_background_music(
                    video_path=video_path,
                    music_path=music_prepared_path,
                    output_path=output_path,
                    music_volume=adjusted_music_volume,
                    original_volume=original_volume,
                )
                audio_preserved = True
                music_added = True
            
            if not mix_result["success"]:
                return {
                    "success": False,
                    "audio_mode": audio_mode,
                    "warnings": mix_result.get("warnings", ["FFmpeg mixing failed."]),
                }
            
            warnings.extend(mix_result.get("warnings", []))
            
            return {
                "success": True,
                "output_path": str(output_path),
                "output_url": f"/download/edited-video/{video_id}/{output_filename}",
                "output_filename": output_filename,
                "audio_mode": audio_mode,
                "audio_preserved": audio_preserved,
                "music_added": music_added,
                "track_title": track.get("title", "Unknown"),
                "track_artist": track.get("artist", "Unknown"),
                "video_duration_seconds": round(video_duration, 2),
                "warnings": _dedupe_preserve_order(warnings),
            }
        
        except Exception as exc:
            return {
                "success": False,
                "audio_mode": audio_mode,
                "warnings": [f"Music mixing failed: {exc}"],
            }


def _download_music_track(url: str, output_path: Path) -> dict[str, Any]:
    """
    Safely download a music track from Jamendo.
    
    Validates URL and handles download failures gracefully.
    """
    output_path = Path(output_path)
    
    # Validate URL
    try:
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"}:
            return {
                "success": False,
                "warnings": [f"Invalid URL scheme: {parsed.scheme}. Must be http or https."],
            }
    except Exception as exc:
        return {
            "success": False,
            "warnings": [f"URL validation failed: {exc}"],
        }
    
    # Download with timeout and retries
    try:
        response = requests.get(url, timeout=30, allow_redirects=True)
        response.raise_for_status()
        
        if len(response.content) < 1024:  # Less than 1KB is likely an error
            return {
                "success": False,
                "warnings": ["Downloaded file is too small (< 1KB). May be an error response."],
            }
        
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(response.content)
        
        return {
            "success": True,
            "file_size_bytes": len(response.content),
            "warnings": [],
        }
    
    except requests.Timeout:
        return {
            "success": False,
            "warnings": ["Music download timed out after 30 seconds."],
        }
    except requests.RequestException as exc:
        return {
            "success": False,
            "warnings": [f"Music download failed: {exc}"],
        }
    except Exception as exc:
        return {
            "success": False,
            "warnings": [f"Unexpected error during music download: {exc}"],
        }


def _prepare_music_track(
    music_path: Path,
    duration_seconds: float,
    output_path: Path,
    fade_in_seconds: float = 1.0,
    fade_out_seconds: float = 1.5,
) -> dict[str, Any]:
    """
    Prepare music track for mixing: trim or loop to match video duration, add fades.
    """
    ffmpeg = _resolve_ffmpeg_executable()
    if not ffmpeg:
        return {
            "success": False,
            "warnings": ["FFmpeg not found. Cannot prepare music track."],
        }
    
    music_path = Path(music_path)
    output_path = Path(output_path)
    
    # Probe music duration
    music_duration = _probe_duration(music_path)
    if music_duration <= 0:
        return {
            "success": False,
            "warnings": ["Could not determine music duration."],
        }
    
    # Build filter chain for trim/loop, fade in, and fade out
    filters = []
    
    if music_duration >= duration_seconds:
        # Trim music to video duration
        filters.append(f"atrim=0:{duration_seconds:.3f}")
    else:
        # Loop music to match video duration
        loop_count = int((duration_seconds / music_duration) + 1)
        filters.append(f"aloop=loop={loop_count}:size=10485760")
        filters.append(f"atrim=0:{duration_seconds:.3f}")
    
    # Add fade in
    if fade_in_seconds > 0:
        filters.append(f"afade=t=in:st=0:d={fade_in_seconds:.3f}")
    
    # Add fade out
    if fade_out_seconds > 0:
        fade_out_start = max(0, duration_seconds - fade_out_seconds)
        filters.append(f"afade=t=out:st={fade_out_start:.3f}:d={fade_out_seconds:.3f}")
    
    filter_complex = ",".join(filters)
    
    try:
        command = [
            ffmpeg,
            "-y",
            "-i", str(music_path),
            "-filter:a", filter_complex,
            "-c:a", "aac",
            "-b:a", "128k",
            str(output_path),
        ]
        
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=120,
        )
        
        if result.returncode != 0:
            error_msg = (result.stderr or result.stdout or "Unknown error").strip()
            return {
                "success": False,
                "warnings": [f"Music preparation failed: {error_msg}"],
            }
        
        if not output_path.exists() or output_path.stat().st_size == 0:
            return {
                "success": False,
                "warnings": ["Music preparation produced empty file."],
            }
        
        return {
            "success": True,
            "music_duration": music_duration,
            "prepared_duration": duration_seconds,
            "warnings": [],
        }
    
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "warnings": ["Music preparation timed out."],
        }
    except Exception as exc:
        return {
            "success": False,
            "warnings": [f"Music preparation error: {exc}"],
        }


def _mix_background_music(
    video_path: Path,
    music_path: Path,
    output_path: Path,
    music_volume: float = 0.18,
    original_volume: float = 1.0,
) -> dict[str, Any]:
    """
    Mix background music underneath original audio.
    
    Uses filter_complex to blend audio from both sources.
    """
    ffmpeg = _resolve_ffmpeg_executable()
    if not ffmpeg:
        return {
            "success": False,
            "warnings": ["FFmpeg not found."],
        }
    
    output_path = Path(output_path)
    output_path.unlink(missing_ok=True)
    
    try:
        command = [
            ffmpeg,
            "-y",
            "-i", str(video_path),
            "-i", str(music_path),
            "-filter_complex",
            (
                f"[0:a]volume={original_volume:.3f}[a0];"
                f"[1:a]volume={music_volume:.3f}[a1];"
                f"[a0][a1]amix=inputs=2:duration=first:dropout_transition=2[aout]"
            ),
            "-map", "0:v",
            "-map", "[aout]",
            "-c:v", "copy",
            "-c:a", "aac",
            "-shortest",
            str(output_path),
        ]
        
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=180,
        )
        
        if result.returncode != 0:
            error_msg = (result.stderr or result.stdout or "Unknown error").strip().splitlines()[-1]
            return {
                "success": False,
                "warnings": [f"Audio mixing failed: {error_msg}"],
            }
        
        if not output_path.exists() or output_path.stat().st_size == 0:
            return {
                "success": False,
                "warnings": ["Audio mixing produced empty file."],
            }
        
        return {
            "success": True,
            "warnings": [],
        }
    
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "warnings": ["Audio mixing timed out."],
        }
    except Exception as exc:
        return {
            "success": False,
            "warnings": [f"Audio mixing error: {exc}"],
        }


def _mix_replace_audio(
    video_path: Path,
    music_path: Path,
    output_path: Path,
) -> dict[str, Any]:
    """
    Replace original audio with selected music.
    """
    ffmpeg = _resolve_ffmpeg_executable()
    if not ffmpeg:
        return {
            "success": False,
            "warnings": ["FFmpeg not found."],
        }
    
    output_path = Path(output_path)
    output_path.unlink(missing_ok=True)
    
    try:
        command = [
            ffmpeg,
            "-y",
            "-i", str(video_path),
            "-i", str(music_path),
            "-map", "0:v:0",
            "-map", "1:a:0",
            "-c:v", "copy",
            "-c:a", "aac",
            "-shortest",
            str(output_path),
        ]
        
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=180,
        )
        
        if result.returncode != 0:
            error_msg = (result.stderr or result.stdout or "Unknown error").strip().splitlines()[-1]
            return {
                "success": False,
                "warnings": [f"Audio replacement failed: {error_msg}"],
            }
        
        if not output_path.exists() or output_path.stat().st_size == 0:
            return {
                "success": False,
                "warnings": ["Audio replacement produced empty file."],
            }
        
        return {
            "success": True,
            "warnings": [],
        }
    
    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "warnings": ["Audio replacement timed out."],
        }
    except Exception as exc:
        return {
            "success": False,
            "warnings": [f"Audio replacement error: {exc}"],
        }


def _probe_duration(video_path: Path) -> float:
    """Get duration of video/audio file using ffprobe."""
    ffprobe = _resolve_ffprobe_executable()
    if not ffprobe:
        return 0.0
    
    try:
        result = subprocess.run(
            [
                ffprobe,
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(video_path),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        
        if result.returncode != 0:
            return 0.0
        
        return float((result.stdout or "").strip()) or 0.0
    
    except (subprocess.TimeoutExpired, ValueError):
        return 0.0


def _resolve_ffmpeg_executable() -> str | None:
    """Resolve path to ffmpeg executable."""
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg
    
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


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
        ffprobe_path = exe_dir / "ffprobe.exe"
        if ffprobe_path.exists():
            return str(ffprobe_path)
    except Exception:
        pass
    
    return None


def _get_next_music_version(video_path: Path) -> int:
    """Get the next available music version number."""
    video_dir = video_path.parent
    existing = list(video_dir.glob("edited_music_v*.mp4"))
    if not existing:
        return 1
    
    versions = []
    for path in existing:
        stem = path.stem
        digits = "".join(ch for ch in stem if ch.isdigit())
        if digits:
            versions.append(int(digits))
    
    return (max(versions) if versions else 0) + 1


def _dedupe_preserve_order(items: list[str]) -> list[str]:
    """Remove duplicates while preserving order."""
    seen = set()
    result = []
    for item in items:
        if item not in seen:
            seen.add(item)
            result.append(item)
    return result
