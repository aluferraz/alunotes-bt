"""Single-model memory manager for resource-constrained devices.

On a 16GB Pi, only one large model can be in RAM at a time. This module
coordinates loading/unloading across the LLM slot, ASR (Qwen3), and
diarization (pyannote) so they never compete for memory.

The LLM itself runs at a remote (or separately-managed) OpenAI-compatible
endpoint — we can't unload it from here, but we still free ASR/diarization
before LLM requests so a co-located server has room.

Usage:
    from alunotes_ai.memory import mem

    mem.acquire("asr")   # unloads whatever else is loaded, marks ASR active
    # ... use the ASR model ...

    mem.acquire("llm")   # unloads ASR, signals the LLM slot is in use
    # ... forward request to OpenAI-compatible endpoint ...
"""

import gc
import logging
import threading
from typing import Literal

logger = logging.getLogger(__name__)

Slot = Literal["llm", "asr", "diarization", "idle"]


class MemoryManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._active: Slot = "idle"

    @property
    def active(self) -> Slot:
        return self._active

    def acquire(self, slot: Slot) -> None:
        """Ensure only `slot` is loaded. Unloads the current occupant first."""
        with self._lock:
            if self._active == slot:
                return

            if self._active != "idle":
                logger.info("memory: unloading %s to make room for %s", self._active, slot)
                self._unload(self._active)

            self._active = slot
            logger.info("memory: slot %s is now active", slot)

    def release(self) -> None:
        """Unload whatever is active."""
        with self._lock:
            if self._active != "idle":
                self._unload(self._active)
                self._active = "idle"

    def _unload(self, slot: Slot) -> None:
        if slot == "asr":
            self._unload_asr()
        elif slot == "diarization":
            self._unload_diarization()
        # "llm" is externally managed — nothing to unload locally.

    def _unload_asr(self) -> None:
        """Delete the ASR model singleton and free memory."""
        try:
            from .asr import engine as asr_engine

            if asr_engine._model is not None:
                del asr_engine._model
                asr_engine._model = None
                asr_engine._model_has_aligner = False
                gc.collect()
                self._try_empty_cuda_cache()
                self._try_malloc_trim()
                logger.info("memory: ASR model unloaded")
        except Exception as e:
            logger.warning("memory: failed to unload ASR: %s", e)

    def _unload_diarization(self) -> None:
        """Delete both the diarization pipeline and ASR model."""
        try:
            from .diarization import engine as diar_engine

            if diar_engine._diarization_pipeline is not None:
                del diar_engine._diarization_pipeline
                diar_engine._diarization_pipeline = None
                gc.collect()
                self._try_empty_cuda_cache()
                self._try_malloc_trim()
                logger.info("memory: diarization pipeline unloaded")
        except Exception as e:
            logger.warning("memory: failed to unload diarization pipeline: %s", e)

        # Diarization also uses ASR — unload that too
        self._unload_asr()

    def _try_malloc_trim(self) -> None:
        """Force glibc to return freed memory to the OS (Linux only).

        CPython's pymalloc + glibc keep freed pages mapped. After unloading
        multi-GiB models, RSS stays high even though Python objects are gone.
        malloc_trim gives the pages back so other processes can use the RAM.
        """
        try:
            import ctypes

            libc = ctypes.CDLL("libc.so.6")
            libc.malloc_trim(0)
            logger.info("memory: malloc_trim released pages to OS")
        except Exception:
            pass  # not Linux/glibc — skip silently

    def _try_empty_cuda_cache(self) -> None:
        try:
            import torch

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass


mem = MemoryManager()
