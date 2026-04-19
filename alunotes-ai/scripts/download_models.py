"""Populate a local HuggingFace cache with every model the runtime needs.

Invoked once at image-build time from Dockerfile. After this runs, the
runtime container can operate fully offline — pyannote + Qwen3-ASR load
their weights from $HF_HOME without touching the network.

HF_TOKEN must be set (read-scoped is enough) and the caller must have
accepted the gated-model terms at:
  https://hf.co/pyannote/speaker-diarization-3.1
  https://hf.co/pyannote/segmentation-3.0
  https://hf.co/pyannote/wespeaker-voxceleb-resnet34-LM
"""

from __future__ import annotations

import os
import sys

from huggingface_hub import snapshot_download

# pyannote/speaker-diarization-3.1 is a pipeline config that references the
# two submodels below — we need all three cached locally.
DIARIZATION_REPOS = [
    "pyannote/speaker-diarization-3.1",
    "pyannote/segmentation-3.0",
    "pyannote/wespeaker-voxceleb-resnet34-LM",
]

ASR_REPOS = [
    "Qwen/Qwen3-ASR-1.7B",
]

# Forced aligner is ~1.2GB. Skip by setting ALUNOTES_AI_USE_FORCED_ALIGNER=false
# at build time to keep the image smaller.
if os.environ.get("ALUNOTES_AI_USE_FORCED_ALIGNER", "true").lower() != "false":
    ASR_REPOS.append("Qwen/Qwen3-ForcedAligner-0.6B")


def main() -> int:
    token = os.environ.get("HF_TOKEN")
    if not token:
        print(
            "error: HF_TOKEN is required to download gated pyannote models.\n"
            "       create one at https://hf.co/settings/tokens and accept the\n"
            "       terms on each pyannote repo before rebuilding the ai image.",
            file=sys.stderr,
        )
        return 1

    for repo in DIARIZATION_REPOS + ASR_REPOS:
        print(f"==> downloading {repo}", flush=True)
        snapshot_download(repo_id=repo, token=token)

    print("==> all models cached in", os.environ.get("HF_HOME", "~/.cache/huggingface"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
