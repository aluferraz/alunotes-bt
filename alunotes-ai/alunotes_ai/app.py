"""FastAPI application factory for alunotes-ai."""

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from .asr.router import router as asr_router
from .config import settings
from .diarization.router import router as diarization_router
from .inference.router import router as inference_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    if settings.use_queue:
        from .queue import job_queue
        await job_queue.start()

    # Pre-warm MIOpen's kernel cache on GPU so the first user request doesn't
    # eat the 100-200 s cold JIT. Runs in a background task — the server is
    # ready to accept requests immediately; early requests just take CPU-time
    # or queue until warmup finishes. Cache persists under ~/.cache/miopen.
    if settings.use_diarization and settings.warmup_diarization_on_start:
        async def _warmup():
            from .diarization.engine import warmup_diarization
            logger.info("diarization GPU warmup starting (first boot: ~2-3 min)")
            await asyncio.to_thread(warmup_diarization)
            logger.info("diarization GPU warmup complete")
        asyncio.create_task(_warmup())

    yield

    if settings.use_queue:
        from .queue import job_queue
        await job_queue.stop()


def create_app() -> FastAPI:
    app = FastAPI(title="alunotes-ai", version="0.1.0", lifespan=lifespan)
    app.include_router(inference_router)
    app.include_router(asr_router)
    app.include_router(diarization_router)
    return app


app = create_app()
