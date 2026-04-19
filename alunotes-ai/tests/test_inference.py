"""Integration tests for the OpenAI-compatible inference endpoint."""

import json
import os

import httpx
import pytest
from httpx import AsyncClient

from alunotes_ai.config import settings


def _upstream_available() -> bool:
    """Check if the configured OpenAI-compatible endpoint is reachable."""
    try:
        resp = httpx.get(
            f"{settings.openai_base_url.rstrip('/')}/models",
            headers={"Authorization": f"Bearer {settings.openai_api_key}"},
            timeout=2,
        )
        return resp.status_code < 500
    except Exception:
        return False


requires_upstream = pytest.mark.skipif(
    not _upstream_available(),
    reason=f"OpenAI-compatible upstream not reachable at {settings.openai_base_url}",
)

TEST_MODEL = os.environ.get("ALUNOTES_AI_OPENAI_MODEL", settings.openai_model)


@requires_upstream
@pytest.mark.asyncio
async def test_chat_completions_non_streaming(client: AsyncClient):
    """Call /v1/chat/completions, assert OpenAI-schema response."""
    payload = {
        "model": TEST_MODEL,
        "messages": [{"role": "user", "content": "Say hello in one word."}],
        "stream": False,
        "temperature": 0.0,
        "max_tokens": 32,
    }
    resp = await client.post("/v1/chat/completions", json=payload)
    assert resp.status_code == 200

    data = resp.json()
    assert "id" in data
    assert data["object"] == "chat.completion"
    assert "created" in data
    assert "model" in data
    assert "choices" in data
    assert len(data["choices"]) >= 1

    choice = data["choices"][0]
    assert "message" in choice
    assert "role" in choice["message"]
    assert "content" in choice["message"]
    assert choice["message"]["role"] == "assistant"
    assert len(choice["message"]["content"]) > 0

    assert "usage" in data


@requires_upstream
@pytest.mark.asyncio
async def test_chat_completions_streaming(client: AsyncClient):
    """Call /v1/chat/completions with stream=True, assert SSE chunks."""
    payload = {
        "model": TEST_MODEL,
        "messages": [{"role": "user", "content": "Say hi."}],
        "stream": True,
        "max_tokens": 16,
    }
    resp = await client.post("/v1/chat/completions", json=payload)
    assert resp.status_code == 200

    body = resp.text
    assert len(body) > 0

    chunks = []
    for line in body.splitlines():
        if line.startswith("data:"):
            data = line[len("data:"):].strip()
            if data == "[DONE]":
                break
            chunks.append(json.loads(data))

    assert len(chunks) >= 1
    for chunk in chunks:
        assert chunk["object"] == "chat.completion.chunk"
        assert "choices" in chunk
        assert len(chunk["choices"]) >= 1
        assert "delta" in chunk["choices"][0]


@requires_upstream
@pytest.mark.asyncio
async def test_list_models(client: AsyncClient):
    """GET /v1/models should return OpenAI-schema model list."""
    resp = await client.get("/v1/models")
    assert resp.status_code == 200

    data = resp.json()
    assert data["object"] == "list"
    assert "data" in data
    assert isinstance(data["data"], list)
    for model in data["data"]:
        assert "id" in model
        assert model["object"] == "model"
