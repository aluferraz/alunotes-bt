"""FastAPI application factory for alunotes-ai."""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from .asr.router import router as asr_router
from .config import settings
from .diarization.router import router as diarization_router
from .inference.router import router as inference_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    if settings.use_queue:
        from .queue import job_queue
        await job_queue.start()

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
