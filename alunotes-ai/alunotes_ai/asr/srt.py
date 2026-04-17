"""SRT subtitle format generation from timestamped ASR segments."""


def _format_timestamp(seconds: float) -> str:
    """Convert seconds to SRT timestamp format HH:MM:SS,mmm."""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def segments_to_srt(segments: list[dict]) -> str:
    """Convert timestamped segments to SRT subtitle format.

    Args:
        segments: List of dicts with keys: text, start_time, end_time.
            Times are in seconds (float).

    Returns:
        SRT-formatted string.
    """
    if not segments:
        return ""

    lines: list[str] = []
    for i, seg in enumerate(segments, start=1):
        start = _format_timestamp(seg.get("start_time", 0.0))
        end = _format_timestamp(seg.get("end_time", 0.0))
        text = seg.get("text", "").strip()
        if not text:
            continue
        lines.append(f"{i}")
        lines.append(f"{start} --> {end}")
        lines.append(text)
        lines.append("")  # blank line separator

    return "\n".join(lines)
