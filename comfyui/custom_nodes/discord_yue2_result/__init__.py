"""Expose YuE2 generation metadata through ComfyUI's API history.

This is intentionally an opt-in, dependency-free classic custom node. It does
not modify ComfyUI's official YuE2 implementation; it only reads the
conditioning metadata that that implementation already attaches.
"""

FRAMES_PER_SECOND = 25
MAX_DURATION_SECONDS = 360


def _conditioning_metadata(conditioning):
    """Return the first YuE2 metadata mapping from a CONDITIONING value."""
    if not isinstance(conditioning, (list, tuple)):
        return None

    for item in conditioning:
        if isinstance(item, dict):
            candidate = item
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            candidate = item[1]
        else:
            continue
        if isinstance(candidate, dict) and any(
            key in candidate for key in ("yue2_frames", "yue2_truncated", "yue2_abc_ids")
        ):
            return candidate
    return None


def _finite_duration(value, fallback=None):
    if isinstance(value, bool):
        return fallback
    if isinstance(value, (int, float)) and value == value and value not in (float("inf"), float("-inf")):
        return float(value)
    return fallback


def _make_result(conditioning, target_duration_sec, max_duration_sec):
    target = _finite_duration(target_duration_sec)
    hard_cap = _finite_duration(max_duration_sec)
    metadata = _conditioning_metadata(conditioning)

    frames = metadata.get("yue2_frames") if metadata else None
    truncated_value = metadata.get("yue2_truncated") if metadata else None
    abc_ids = metadata.get("yue2_abc_ids") if metadata else None

    frames_valid = isinstance(frames, int) and not isinstance(frames, bool) and frames > 0
    abc_metadata_present = isinstance(abc_ids, (list, tuple, str))
    abc_nonempty = bool(abc_ids) if abc_metadata_present else False
    metadata_valid = (
        frames_valid
        and isinstance(truncated_value, bool)
        and abc_metadata_present
        and target is not None
        and target >= 0.04
        and hard_cap is not None
        and 0.04 <= hard_cap <= MAX_DURATION_SECONDS
        and target <= hard_cap
    )

    # Missing or malformed metadata fails closed. In particular, False here
    # must never be inferred from actual duration or from the requested target.
    actual_duration = round(frames / FRAMES_PER_SECOND, 3) if frames_valid else None
    result = {
        "actualDurationSec": actual_duration,
        "targetDurationSec": target,
        "maxDurationSec": hard_cap,
        "frames": frames if frames_valid else None,
        "truncated": bool(truncated_value) if isinstance(truncated_value, bool) else True,
        "abcNonempty": abc_nonempty,
        "metadataAvailable": metadata_valid,
    }
    if not metadata_valid:
        result["status"] = "metadata_unavailable"
    else:
        result["status"] = "ok"
    return result


class DiscordYuE2Result:
    """Output one JSON-compatible ``yue2_result`` UI value for API clients."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "conditioning": ("CONDITIONING",),
                "target_duration_sec": (
                    "FLOAT",
                    {"default": 120.0, "min": 0.04, "max": MAX_DURATION_SECONDS, "step": 0.04},
                ),
                "max_duration_sec": (
                    "FLOAT",
                    {"default": MAX_DURATION_SECONDS, "min": 0.04, "max": MAX_DURATION_SECONDS, "step": 0.04},
                ),
            }
        }

    RETURN_TYPES = ()
    FUNCTION = "emit_result"
    OUTPUT_NODE = True
    CATEGORY = "audio/metadata"

    def emit_result(self, conditioning, target_duration_sec=120.0, max_duration_sec=MAX_DURATION_SECONDS):
        return {"ui": {"yue2_result": [_make_result(conditioning, target_duration_sec, max_duration_sec)]}}


NODE_CLASS_MAPPINGS = {
    "DiscordYuE2Result": DiscordYuE2Result,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DiscordYuE2Result": "Discord YuE2 Result Metadata",
}
