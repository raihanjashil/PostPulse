import json
import math
import shutil
import subprocess
from pathlib import Path
from typing import Any

import cv2
import numpy as np

OUTPUT_FILENAME = "edited_video.mp4"
OUTPUT_PATH = Path(__file__).with_name(OUTPUT_FILENAME)
VERSIONS_DIR = Path(__file__).with_name("edited_versions")

TARGET_CANVAS = {
    "instagram": (1080, 1920),
    "tiktok": (1080, 1920),
    "youtube": (1920, 1080),
    "linkedin": (1280, 720),
    "facebook": (1280, 720),
    "twitter": (1280, 720),
}


def apply_auto_edit_from_upload(
    video_path: str | Path,
    analysis_payload: Any,
    target_platform: str | None = None,
    output_path: str | Path = OUTPUT_PATH,
    extra_commands: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    source_path = Path(video_path)
    if not source_path.exists():
        raise FileNotFoundError(f"Source video not found: {source_path}")

    payload = analysis_payload if isinstance(analysis_payload, dict) else {}
    analysis = _extract_analysis_block(payload)

    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    transcript = payload.get("transcript") if isinstance(payload.get("transcript"), dict) else {}
    base_suggestions = list(analysis.get("edit_suggestions") or [])
    command_history = list(extra_commands or [])
    suggestions = base_suggestions + _chat_commands_to_suggestions(command_history)
    platform = _resolve_target_platform(
        target_platform=target_platform,
        payload=payload,
        analysis=analysis,
        chat_commands=command_history,
    )
    audio_directives = _build_audio_directives(command_history)

    cap = cv2.VideoCapture(str(source_path))
    if not cap.isOpened():
        raise RuntimeError("OpenCV could not open the source video for editing.")

    try:
        source_fps = _safe_positive_float(cap.get(cv2.CAP_PROP_FPS)) or 30.0
        frame_count = _safe_positive_int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        source_width = _safe_positive_int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        source_height = _safe_positive_int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        duration_seconds = _safe_positive_float(metadata.get("duration_seconds")) or (
            round(frame_count / source_fps, 2) if frame_count and source_fps else 0.0
        )
        canvas_width, canvas_height = _choose_canvas(platform, source_width, source_height, suggestions)
        crop_requested = _has_edit_type(suggestions, "crop")
        resize_requested = crop_requested or _has_edit_type(suggestions, "resize") or (canvas_width, canvas_height) != (source_width, source_height)

        cut_intervals, cut_warnings = _build_cut_intervals(suggestions, duration_seconds)
        overlay_events = _build_overlay_events(suggestions, analysis)
        subtitle_segments = _build_subtitle_segments(transcript, analysis)

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.unlink(missing_ok=True)
        rendered_path = output_path.with_name(f"{output_path.stem}.video_only{output_path.suffix}")
        rendered_path.unlink(missing_ok=True)

        writer = cv2.VideoWriter(
            str(rendered_path),
            cv2.VideoWriter_fourcc(*"mp4v"),
            source_fps,
            (canvas_width, canvas_height),
        )
        if not writer.isOpened():
            raise RuntimeError("OpenCV could not open the output video writer.")

        written_frames = 0
        processed_frames = 0
        frame_index = 0
        try:
            while True:
                ok, frame = cap.read()
                if not ok:
                    break

                timestamp = frame_index / source_fps if source_fps else 0.0
                frame_index += 1
                processed_frames += 1

                if _is_in_intervals(timestamp, cut_intervals):
                    continue

                if crop_requested:
                    rendered = _render_crop_canvas(frame, canvas_width, canvas_height)
                elif resize_requested:
                    rendered = _render_canvas(frame, canvas_width, canvas_height)
                else:
                    rendered = cv2.resize(
                        frame,
                        (canvas_width, canvas_height),
                        interpolation=cv2.INTER_AREA if frame.shape[1] > canvas_width else cv2.INTER_LINEAR,
                    )
                _draw_overlay_events(rendered, timestamp, overlay_events, subtitle_segments, canvas_width, canvas_height)
                writer.write(rendered)
                written_frames += 1
        finally:
            writer.release()

        if written_frames == 0:
            raise RuntimeError("Auto-edit produced no frames. The cut suggestions may have removed too much of the clip.")

        audio_preserved = _mux_original_audio_if_possible(
            source_path=source_path,
            rendered_video_path=rendered_path,
            final_output_path=output_path,
            cut_intervals=cut_intervals,
            warnings=cut_warnings,
            audio_directives=audio_directives,
            source_duration_seconds=duration_seconds,
        )

        applied_edits = _build_applied_edits(base_suggestions, command_history)

        return {
            "output_filename": Path(output_path).name,
            "output_path": str(output_path),
            "target_platform": platform,
            "input_duration_seconds": round(duration_seconds, 2),
            "output_frame_count": written_frames,
            "source_frame_count": processed_frames,
            "canvas": {"width": canvas_width, "height": canvas_height},
            "applied_edits": applied_edits,
            "audio_preserved": audio_preserved,
            "warnings": cut_warnings,
        }
    finally:
        cap.release()


def _extract_analysis_block(payload: dict[str, Any]) -> dict[str, Any]:
    if isinstance(payload.get("analysis"), dict):
        return payload["analysis"]
    return payload


def get_video_workspace(video_id: str) -> Path:
    workspace = VERSIONS_DIR / video_id
    workspace.mkdir(parents=True, exist_ok=True)
    return workspace


def build_version_filename(version_number: int) -> str:
    safe_number = max(1, int(version_number))
    return f"edited_v{safe_number}.mp4"


def build_version_path(video_id: str, version_number: int) -> Path:
    return get_video_workspace(video_id) / build_version_filename(version_number)


def build_source_path(video_id: str, suffix: str = ".mp4") -> Path:
    safe_suffix = suffix if suffix.startswith(".") else f".{suffix}"
    return get_video_workspace(video_id) / f"original{safe_suffix}"


def list_rendered_versions(video_id: str) -> list[str]:
    workspace = get_video_workspace(video_id)
    versions = sorted(
        [path.name for path in workspace.glob("edited_v*.mp4")],
        key=_version_sort_key,
    )
    return versions


def find_source_path(video_id: str) -> Path | None:
    workspace = get_video_workspace(video_id)
    matches = sorted(workspace.glob("original.*"))
    return matches[0] if matches else None


def latest_render_path(video_id: str | None = None) -> Path | None:
    candidates: list[Path] = []
    if video_id:
        candidates = [get_video_workspace(video_id) / name for name in list_rendered_versions(video_id)]
    else:
        candidates = sorted(VERSIONS_DIR.glob("*/edited_v*.mp4"), key=lambda path: path.stat().st_mtime if path.exists() else 0)
    return candidates[-1] if candidates else (OUTPUT_PATH if OUTPUT_PATH.exists() else None)


def next_version_number(video_id: str) -> int:
    versions = list_rendered_versions(video_id)
    if not versions:
        return 1
    return _version_sort_key(versions[-1]) + 1


def _resolve_target_platform(
    target_platform: str | None,
    payload: dict[str, Any],
    analysis: dict[str, Any],
    chat_commands: list[dict[str, Any]],
) -> str:
    for command in reversed(chat_commands):
        if str(command.get("type", "")).strip() in {"resize", "crop"}:
            platform = str(command.get("platform", "")).strip().lower()
            if platform in TARGET_CANVAS:
                return platform
    return (target_platform or payload.get("target_platform") or analysis.get("target_platform") or "instagram").lower()


def _choose_canvas(platform: str, source_width: int, source_height: int, suggestions: list[dict[str, Any]]) -> tuple[int, int]:
    if _has_edit_type(suggestions, "resize") or _has_edit_type(suggestions, "crop") or platform in TARGET_CANVAS:
        return TARGET_CANVAS.get(platform, (1280, 720))
    if source_width > 0 and source_height > 0:
        return source_width, source_height
    return 1280, 720


def _build_cut_intervals(suggestions: list[dict[str, Any]], duration_seconds: float) -> tuple[list[tuple[float, float]], list[str]]:
    intervals: list[tuple[float, float]] = []
    warnings: list[str] = []

    for item in suggestions:
        if str(item.get("type", "")).strip() != "cut":
            continue

        start = max(0.0, min(duration_seconds, _to_float(item.get("start"))))
        end = max(start, min(duration_seconds, _to_float(item.get("end"))))
        span = end - start

        if span < 0.5:
            warnings.append(f"Skipped cut suggestion {start:.2f}-{end:.2f} because it was too small to matter.")
            continue

        if duration_seconds > 0 and span / duration_seconds >= 0.5:
            warnings.append(
                f"Skipped cut suggestion {start:.2f}-{end:.2f} because it would remove most of the clip."
            )
            continue

        intervals.append((start, end))

    if not intervals:
        return [], warnings

    intervals.sort()
    merged: list[tuple[float, float]] = [intervals[0]]
    for start, end in intervals[1:]:
        last_start, last_end = merged[-1]
        if start <= last_end + 0.05:
            merged[-1] = (last_start, max(last_end, end))
        else:
            merged.append((start, end))

    return merged, warnings


def _build_overlay_events(suggestions: list[dict[str, Any]], analysis: dict[str, Any]) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for item in suggestions:
        edit_type = str(item.get("type", "")).strip()
        if edit_type not in {"text_overlay", "cta_overlay"}:
            continue

        text = (
            str(item.get("replacement_text") or "").strip()
            or str(item.get("action") or "").strip()
            or str(item.get("issue") or "").strip()
        )
        if not text and edit_type == "cta_overlay":
            text = str(analysis.get("recommended_cta") or "").strip()
        if not text and edit_type == "text_overlay":
            text = str(analysis.get("recommended_caption") or "").strip()
        if not text:
            text = "Auto edit suggestion"

        events.append(
            {
                "type": edit_type,
                "start": max(0.0, _to_float(item.get("start"))),
                "end": max(0.0, _to_float(item.get("end"))),
                "text": text,
            }
        )

    return events


def _build_subtitle_segments(transcript: dict[str, Any], analysis: dict[str, Any]) -> list[dict[str, Any]]:
    if not transcript.get("available"):
        return []

    segments = []
    for item in transcript.get("segments", []):
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        segments.append(
            {
                "start": max(0.0, _to_float(item.get("start"))),
                "end": max(0.0, _to_float(item.get("end"))),
                "text": text,
            }
        )
    return segments


def _draw_overlay_events(
    frame: np.ndarray,
    timestamp: float,
    overlay_events: list[dict[str, Any]],
    subtitle_segments: list[dict[str, Any]],
    canvas_width: int,
    canvas_height: int,
) -> None:
    active_texts = [event for event in overlay_events if event["type"] in {"text_overlay", "cta_overlay"} and _is_active(timestamp, event["start"], event["end"])]

    for index, event in enumerate(active_texts[:2]):
        y = 84 + (index * 120) if event["type"] == "text_overlay" else canvas_height - 170 - (index * 120)
        _draw_text_box(
            frame,
            event["text"],
            center_x=canvas_width // 2,
            top_y=y,
            box_width=int(canvas_width * 0.82),
            font_scale=max(0.7, canvas_width / 1400),
            box_color=(15, 23, 42),
            text_color=(255, 255, 255),
        )

    subtitle_text = _subtitle_text_at(timestamp, subtitle_segments)
    if subtitle_text:
        _draw_text_box(
            frame,
            subtitle_text,
            center_x=canvas_width // 2,
            top_y=canvas_height - 250,
            box_width=int(canvas_width * 0.84),
            font_scale=max(0.65, canvas_width / 1600),
            box_color=(0, 0, 0),
            text_color=(255, 255, 255),
            alpha=0.68,
        )


def _subtitle_text_at(timestamp: float, segments: list[dict[str, Any]]) -> str:
    for segment in segments:
        if _is_active(timestamp, segment["start"], segment["end"]):
            return segment["text"]
    return ""


def _is_active(timestamp: float, start: float, end: float) -> bool:
    if math.isinf(end):
        return timestamp >= start
    return start <= timestamp <= end


def _is_in_intervals(timestamp: float, intervals: list[tuple[float, float]]) -> bool:
    return any(start <= timestamp <= end for start, end in intervals)


def _render_canvas(frame: np.ndarray, canvas_width: int, canvas_height: int) -> np.ndarray:
    source_height, source_width = frame.shape[:2]
    if source_width <= 0 or source_height <= 0:
        return cv2.resize(frame, (canvas_width, canvas_height))

    bg = cv2.resize(frame, (canvas_width, canvas_height), interpolation=cv2.INTER_LINEAR)
    bg = cv2.GaussianBlur(bg, (0, 0), sigmaX=24, sigmaY=24)

    scale = min(canvas_width / source_width, canvas_height / source_height)
    new_w = max(1, int(round(source_width * scale)))
    new_h = max(1, int(round(source_height * scale)))
    fg = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)

    x = max(0, (canvas_width - new_w) // 2)
    y = max(0, (canvas_height - new_h) // 2)
    bg[y : y + new_h, x : x + new_w] = fg
    return bg


def _render_crop_canvas(frame: np.ndarray, canvas_width: int, canvas_height: int) -> np.ndarray:
    source_height, source_width = frame.shape[:2]
    if source_width <= 0 or source_height <= 0:
        return cv2.resize(frame, (canvas_width, canvas_height))

    scale = max(canvas_width / source_width, canvas_height / source_height)
    new_w = max(1, int(round(source_width * scale)))
    new_h = max(1, int(round(source_height * scale)))
    resized = cv2.resize(frame, (new_w, new_h), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
    x = max(0, (new_w - canvas_width) // 2)
    y = max(0, (new_h - canvas_height) // 2)
    return resized[y : y + canvas_height, x : x + canvas_width]


def _draw_text_box(
    frame: np.ndarray,
    text: str,
    center_x: int,
    top_y: int,
    box_width: int,
    font_scale: float,
    box_color: tuple[int, int, int],
    text_color: tuple[int, int, int],
    alpha: float = 0.8,
) -> None:
    lines = _wrap_text(text, box_width, font_scale)
    if not lines:
        return

    font = cv2.FONT_HERSHEY_SIMPLEX
    line_height = int(34 * font_scale) + 16
    pad_x = 28
    pad_y = 20

    sizes = [cv2.getTextSize(line, font, font_scale, 2)[0] for line in lines]
    box_height = pad_y * 2 + sum(size[1] for size in sizes) + max(0, (len(lines) - 1) * 10)
    box_left = max(16, center_x - box_width // 2)
    box_right = min(frame.shape[1] - 16, center_x + box_width // 2)
    box_top = max(16, top_y)
    box_bottom = min(frame.shape[0] - 16, box_top + box_height)
    if box_bottom <= box_top:
        return

    overlay = frame.copy()
    cv2.rectangle(overlay, (box_left, box_top), (box_right, box_bottom), box_color, -1)
    cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)
    cv2.rectangle(frame, (box_left, box_top), (box_right, box_bottom), (255, 255, 255), 2)

    cursor_y = box_top + pad_y + sizes[0][1]
    for line in lines:
        text_size, _ = cv2.getTextSize(line, font, font_scale, 2)
        text_x = center_x - text_size[0] // 2
        _put_text_stroked(frame, line, (text_x, cursor_y), font, font_scale, text_color)
        cursor_y += text_size[1] + 10


def _put_text_stroked(
    frame: np.ndarray,
    text: str,
    origin: tuple[int, int],
    font: int,
    font_scale: float,
    color: tuple[int, int, int],
) -> None:
    cv2.putText(frame, text, origin, font, font_scale, (0, 0, 0), 4, cv2.LINE_AA)
    cv2.putText(frame, text, origin, font, font_scale, color, 2, cv2.LINE_AA)


def _wrap_text(text: str, box_width: int, font_scale: float) -> list[str]:
    words = text.split()
    if not words:
        return []

    approx_char_limit = max(18, int(box_width / max(10.0, font_scale * 18)))
    lines: list[str] = []
    current: list[str] = []

    for word in words:
        candidate = " ".join(current + [word])
        if len(candidate) <= approx_char_limit:
            current.append(word)
            continue

        if current:
            lines.append(" ".join(current))
            current = [word]
        else:
            lines.append(word)
            current = []

    if current:
        lines.append(" ".join(current))

    return lines


def _chat_commands_to_suggestions(commands: list[dict[str, Any]]) -> list[dict[str, Any]]:
    suggestions: list[dict[str, Any]] = []
    for command in commands:
        edit_type = str(command.get("type", "")).strip()
        if edit_type in {"volume_adjust", "mute"}:
            continue
        if edit_type == "subtitle":
            suggestions.append(
                {
                    "type": "subtitle",
                    "start": _to_float(command.get("start")),
                    "end": _to_float(command.get("end")),
                    "issue": "Subtitle styling was requested by the user.",
                    "action": str(command.get("text") or "Apply subtitles").strip(),
                    "reason": str(command.get("reason") or "User requested subtitles.").strip(),
                    "replacement_text": str(command.get("text") or "").strip(),
                }
            )
            continue

        suggestions.append(
            {
                "type": edit_type or "cut",
                "start": _to_float(command.get("start")),
                "end": _to_float(command.get("end")),
                "issue": str(command.get("reason") or "User requested this edit.").strip(),
                "action": str(command.get("text") or command.get("reason") or "Apply requested edit").strip(),
                "reason": str(command.get("reason") or "User requested this edit.").strip(),
                "replacement_text": str(command.get("text") or "").strip(),
            }
        )
    return suggestions


def _build_audio_directives(commands: list[dict[str, Any]]) -> dict[str, Any]:
    directives = {"mute": False, "volume_multiplier": 1.0}
    for command in commands:
        edit_type = str(command.get("type", "")).strip()
        if edit_type == "mute":
            directives["mute"] = True
            directives["volume_multiplier"] = 0.0
        elif edit_type == "volume_adjust" and not directives["mute"]:
            multiplier = _safe_positive_float(command.get("value")) or 1.0
            directives["volume_multiplier"] = multiplier
    return directives


def _build_applied_edits(
    base_suggestions: list[dict[str, Any]],
    chat_commands: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    applied: list[dict[str, Any]] = []
    for item in base_suggestions:
        edit_type = str(item.get("type", "")).strip()
        if edit_type not in {"cut", "text_overlay", "cta_overlay", "subtitle", "resize", "crop"}:
            continue
        applied.append(
            {
                "type": edit_type,
                "start": item.get("start"),
                "end": item.get("end"),
                "text": item.get("replacement_text") or "",
                "reason": item.get("reason") or "",
                "source": "analysis",
            }
        )
    for item in chat_commands:
        applied.append(
            {
                "type": str(item.get("type", "")).strip() or "cut",
                "start": item.get("start"),
                "end": item.get("end"),
                "text": item.get("text") or "",
                "reason": item.get("reason") or "",
                "platform": item.get("platform") or "",
                "value": item.get("value"),
                "source": "chat",
            }
        )
    return applied


def _has_edit_type(suggestions: list[dict[str, Any]], edit_type: str) -> bool:
    return any(str(item.get("type", "")).strip() == edit_type for item in suggestions)


def _mux_original_audio_if_possible(
    source_path: Path,
    rendered_video_path: Path,
    final_output_path: Path,
    cut_intervals: list[tuple[float, float]],
    warnings: list[str],
    audio_directives: dict[str, Any],
    source_duration_seconds: float,
) -> bool:
    if audio_directives.get("mute"):
        warnings.append("Audio was muted for this version.")
        rendered_video_path.replace(final_output_path)
        return False

    if cut_intervals:
        try:
            _mux_cut_audio_with_ffmpeg(
                source_path=source_path,
                rendered_video_path=rendered_video_path,
                final_output_path=final_output_path,
                cut_intervals=cut_intervals,
                volume_multiplier=float(audio_directives.get("volume_multiplier") or 1.0),
                source_duration_seconds=source_duration_seconds,
            )
            rendered_video_path.unlink(missing_ok=True)
            return True
        except Exception as exc:
            warnings.append(f"Cut audio sync failed; exported video is silent: {exc}")
            rendered_video_path.replace(final_output_path)
            return False

    try:
        _mux_with_ffmpeg(
            source_path=source_path,
            rendered_video_path=rendered_video_path,
            final_output_path=final_output_path,
            volume_multiplier=float(audio_directives.get("volume_multiplier") or 1.0),
        )
        rendered_video_path.unlink(missing_ok=True)
        return True
    except Exception as exc:
        warnings.append(f"Audio muxing failed; exported video is silent: {exc}")
        if rendered_video_path.exists():
            rendered_video_path.replace(final_output_path)
        return False


def _mux_with_ffmpeg(
    source_path: Path,
    rendered_video_path: Path,
    final_output_path: Path,
    volume_multiplier: float = 1.0,
) -> None:
    ffmpeg = _resolve_ffmpeg_executable()
    if not ffmpeg:
        raise RuntimeError("FFmpeg is not installed. Install ffmpeg or the imageio-ffmpeg Python package.")

    temp_output = final_output_path.with_name(f"{final_output_path.stem}.muxed{final_output_path.suffix}")
    temp_output.unlink(missing_ok=True)

    command = [
        ffmpeg,
        "-y",
        "-i",
        str(rendered_video_path),
        "-i",
        str(source_path),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0?",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "veryfast",
    ]
    if abs(volume_multiplier - 1.0) > 0.001:
        command.extend(["-filter:a", f"volume={volume_multiplier:.3f}"])
    command.extend(
        [
            "-c:a",
            "aac",
            "-shortest",
            str(temp_output),
        ]
    )

    result = subprocess.run(command, capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        message = (result.stderr or result.stdout or "unknown ffmpeg error").strip().splitlines()[-1]
        raise RuntimeError(message)
    if not temp_output.exists() or temp_output.stat().st_size == 0:
        raise RuntimeError("FFmpeg produced an empty output file.")

    temp_output.replace(final_output_path)


def _mux_cut_audio_with_ffmpeg(
    source_path: Path,
    rendered_video_path: Path,
    final_output_path: Path,
    cut_intervals: list[tuple[float, float]],
    volume_multiplier: float = 1.0,
    source_duration_seconds: float = 0.0,
) -> None:
    ffmpeg = _resolve_ffmpeg_executable()
    if not ffmpeg:
        raise RuntimeError("FFmpeg is not installed. Install ffmpeg or the imageio-ffmpeg Python package.")

    keep_intervals = _build_keep_intervals(source_path, cut_intervals, source_duration_seconds)
    if not keep_intervals:
        raise RuntimeError("No audio ranges remain after cuts.")

    temp_output = final_output_path.with_name(f"{final_output_path.stem}.muxed{final_output_path.suffix}")
    temp_output.unlink(missing_ok=True)

    command = [ffmpeg, "-y", "-i", str(rendered_video_path), "-i", str(source_path)]
    filter_parts: list[str] = []
    audio_labels: list[str] = []
    for index, (start, end) in enumerate(keep_intervals):
        label = f"a{index}"
        filter_parts.append(
            f"[1:a:0]atrim=start={start:.3f}:end={end:.3f},asetpts=PTS-STARTPTS[{label}]"
        )
        audio_labels.append(f"[{label}]")

    concat_label = "acut"
    if len(audio_labels) == 1:
        filter_parts.append(f"{audio_labels[0]}anull[{concat_label}]")
    else:
        filter_parts.append(f"{''.join(audio_labels)}concat=n={len(audio_labels)}:v=0:a=1[{concat_label}]")

    final_audio_label = concat_label
    if abs(volume_multiplier - 1.0) > 0.001:
        final_audio_label = "aout"
        filter_parts.append(f"[{concat_label}]volume={volume_multiplier:.3f}[{final_audio_label}]")

    command.extend(
        [
            "-filter_complex",
            ";".join(filter_parts),
            "-map",
            "0:v:0",
            "-map",
            f"[{final_audio_label}]",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-preset",
            "veryfast",
            "-c:a",
            "aac",
            "-shortest",
            str(temp_output),
        ]
    )

    result = subprocess.run(command, capture_output=True, text=True, timeout=180)
    if result.returncode != 0:
        message = (result.stderr or result.stdout or "unknown ffmpeg error").strip().splitlines()[-1]
        raise RuntimeError(message)
    if not temp_output.exists() or temp_output.stat().st_size == 0:
        raise RuntimeError("FFmpeg produced an empty output file.")

    temp_output.replace(final_output_path)


def _build_keep_intervals(
    source_path: Path,
    cut_intervals: list[tuple[float, float]],
    source_duration_seconds: float = 0.0,
) -> list[tuple[float, float]]:
    duration = _safe_positive_float(source_duration_seconds) or _probe_duration_with_ffmpeg(source_path)
    if duration <= 0:
        duration = max((end for _, end in cut_intervals), default=0.0)
    keep_intervals: list[tuple[float, float]] = []
    cursor = 0.0
    for start, end in sorted(cut_intervals):
        start = max(0.0, min(duration, start))
        end = max(start, min(duration, end))
        if start > cursor + 0.05:
            keep_intervals.append((cursor, start))
        cursor = max(cursor, end)
    if duration > cursor + 0.05:
        keep_intervals.append((cursor, duration))
    return keep_intervals


def _probe_duration_with_ffmpeg(source_path: Path) -> float:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return 0.0
    result = subprocess.run(
        [
            ffprobe,
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(source_path),
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode != 0:
        return 0.0
    return _safe_positive_float((result.stdout or "").strip()) or 0.0


def _resolve_ffmpeg_executable() -> str | None:
    ffmpeg = shutil.which("ffmpeg")
    if ffmpeg:
        return ffmpeg

    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def _version_sort_key(filename: str | Path) -> int:
    match = Path(filename).stem
    digits = "".join(ch for ch in match if ch.isdigit())
    return int(digits) if digits else 0


def _safe_positive_float(value: Any) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    return number if number > 0 else 0.0


def _safe_positive_int(value: Any) -> int:
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return 0
    return number if number > 0 else 0


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0
