"""Content Studio: take selection, edit planning and rendering for Phase 2.

Everything here is deterministic and runs locally (FFmpeg + skia + numpy).
Claude is optional: it can enrich an edit plan or apply a free-text revision,
but its output is always validated against `schema.Plan` before rendering.
"""
STUDIO_VERSION = "studio-1.0.0"
