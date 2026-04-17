"""Environment-driven settings for alunotes-ai."""

import torch
from pydantic_settings import BaseSettings


def _detect_device() -> str:
    if torch.cuda.is_available():
        return "cuda:0"
    if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


class Settings(BaseSettings):
    model_config = {"env_prefix": "ALUNOTES_AI_"}

    # Ollama
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "huihui_ai/gemma-4-abliterated:e2b"

    # ASR
    asr_model_path: str = "Qwen/Qwen3-ASR-0.6B"
    asr_forced_aligner_path: str = "Qwen/Qwen3-ForcedAligner-0.6B"
    asr_device: str = _detect_device()
    asr_max_new_tokens: int | None = None
    asr_max_batch_size: int = 4

    # Feature flags
    use_queue: bool = True
    use_forced_aligner: bool = True
    use_diarization: bool = True
    use_hallucination_filter: bool = True
    use_resampling: bool = True

    # Job TTL (seconds)
    asr_job_ttl: int = 300
    diarize_job_ttl: int = 600
    llm_job_ttl: int = 300

    # Queue monitor
    queue_monitor_interval: int = 30

    # Server
    host: str = "0.0.0.0"
    port: int = 8100


settings = Settings()
