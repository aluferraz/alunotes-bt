"""Shared test fixtures."""

import gc
import os

# Enforce offline mode for all tests
os.environ["TRANSFORMERS_OFFLINE"] = "1"
os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
os.environ["HF_DATASETS_OFFLINE"] = "1"
os.environ["DO_NOT_TRACK"] = "1"

import pytest
from httpx import ASGITransport, AsyncClient

from alunotes_ai.app import create_app


@pytest.fixture
def app():
    return create_app()


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app, raise_app_exceptions=False)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c
