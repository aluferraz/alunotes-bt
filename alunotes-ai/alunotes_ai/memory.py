"""Single-model memory manager for resource-constrained devices.

On a 16GB Pi, only one large model can be in RAM at a time. This module
coordinates loading/unloading across the LLM slot, ASR (Qwen3), and
diarization (pyannote) so they never compete for memory.

When ``settings.lmstudio_enabled`` is true, the LLM slot is backed by the
lmstudio SDK: acquiring the slot loads the configured model into LM Studio,
and switching to ASR/diarization unloads it again. On hardware with enough
RAM to keep everything resident, set ``lmstudio_keep_loaded=True`` and the
LLM stays in memory across slot switches. With the flag disabled the LLM is
treated as externally managed (e.g. a remote endpoint) and the memory
manager only frees ASR/diarization to make room.

Usage:
    from alunotes_ai.memory import mem

    mem.acquire("asr")   # unloads whatever else is loaded, marks ASR active
    # ... use the ASR model ...

    mem.acquire("llm")   # unloads ASR, ensures the LLM is loaded in LM Studio
    # ... forward request to OpenAI-compatible endpoint ...
"""

import gc
import logging
import threading
from typing import Any, Literal

logger = logging.getLogger(__name__)

Slot = Literal["llm", "asr", "diarization", "idle"]


class MemoryManager:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._active: Slot = "idle"
        self._lmstudio_client: Any | None = None
        self._lmstudio_handle: Any | None = None
        self._lmstudio_timeout_set: bool = False

    @property
    def active(self) -> Slot:
        return self._active

    def acquire(self, slot: Slot) -> None:
        """Ensure only `slot` is loaded. Unloads the current occupant first."""
        with self._lock:
            if self._active == slot:
                if slot == "llm":
                    self._ensure_llm_loaded()
                return

            if self._active != "idle":
                logger.info("memory: unloading %s to make room for %s", self._active, slot)
                self._unload(self._active)

            self._active = slot
            logger.info("memory: slot %s is now active", slot)

            if slot == "llm":
                self._ensure_llm_loaded()

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
        elif slot == "llm":
            self._unload_llm()

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

    def _ensure_llm_loaded(self) -> None:
        """Load the configured LM Studio model if managed locally."""
        from .config import settings

        if not settings.lmstudio_enabled:
            return

        model_key = settings.lmstudio_model_key or settings.openai_model
        if not model_key:
            logger.warning("memory: lmstudio_enabled but no model key configured")
            return

        try:
            client = self._get_lmstudio_client()
            kwargs: dict[str, Any] = {}
            if settings.lmstudio_ttl is not None:
                kwargs["ttl"] = settings.lmstudio_ttl
            if settings.lmstudio_context_length is not None:
                kwargs["config"] = {"contextLength": settings.lmstudio_context_length}
            self._lmstudio_handle = client.llm.model(model_key, **kwargs)
            logger.info("memory: lmstudio LLM model %s ready", model_key)
        except Exception:
            logger.exception("memory: failed to load LLM via lmstudio")

    def _unload_llm(self) -> None:
        from .config import settings

        if not settings.lmstudio_enabled:
            return
        if settings.lmstudio_keep_loaded:
            logger.info("memory: lmstudio_keep_loaded=True — leaving LLM resident")
            return
        if self._lmstudio_handle is None:
            return

        try:
            self._lmstudio_handle.unload()
            logger.info("memory: lmstudio LLM model unloaded")
        except Exception:
            logger.exception("memory: failed to unload LLM via lmstudio")
        finally:
            self._lmstudio_handle = None
            self._try_empty_cuda_cache()
            self._try_malloc_trim()

    def _get_lmstudio_client(self) -> Any:
        if self._lmstudio_client is not None:
            return self._lmstudio_client

        import lmstudio as lms

        from .config import settings

        if not self._lmstudio_timeout_set:
            # Loading multi-GiB GGUFs can easily exceed the 60s default.
            try:
                lms.set_sync_api_timeout(settings.lmstudio_load_timeout)
            except Exception:
                logger.debug("memory: could not set lmstudio sync timeout", exc_info=True)
            self._lmstudio_timeout_set = True

        self._lmstudio_client = lms.Client(settings.lmstudio_host) if settings.lmstudio_host else lms.get_default_client()
        return self._lmstudio_client

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
