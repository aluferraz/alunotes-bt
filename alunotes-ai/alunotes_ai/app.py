"""FastAPI application factory for alunotes-ai."""

from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI

from .inference.router import router as inference_router
from .asr.router import router as asr_router
from .diarization.router import router as diarization_router


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    # Startup: ASR model loading happens lazily on first request
    yield
    # Shutdown: nothing to clean up


def create_app() -> FastAPI:
    app = FastAPI(title="alunotes-ai", version="0.1.0", lifespan=lifespan)
    app.include_router(inference_router)
    app.include_router(asr_router)
    app.include_router(diarization_router)
    return app


app = create_app()
