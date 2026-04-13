"""OpenAI-compatible inference router backed by Ollama."""

import time
import uuid
from typing import Any, AsyncIterator

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from ..config import settings
from ..memory import mem

router = APIRouter()


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatCompletionRequest(BaseModel):
    model: str = ""
    messages: list[ChatMessage]
    stream: bool = False
    temperature: float = 0.7
    max_tokens: int | None = None


class ChatCompletionChoice(BaseModel):
    index: int
    message: ChatMessage
    finish_reason: str | None


class Usage(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class ChatCompletionResponse(BaseModel):
    id: str
    object: str = "chat.completion"
    created: int
    model: str
    choices: list[ChatCompletionChoice]
    usage: Usage


class ModelInfo(BaseModel):
    id: str
    object: str = "model"
    created: int = 0
    owned_by: str = "local"


class ModelsResponse(BaseModel):
    object: str = "list"
    data: list[ModelInfo]


def _ollama_api_url(path: str) -> str:
    return f"{settings.ollama_base_url}{path}"


def _build_ollama_payload(req: ChatCompletionRequest) -> dict[str, Any]:
    model = req.model or settings.ollama_model
    messages = [{"role": m.role, "content": m.content} for m in req.messages]
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "stream": req.stream,
        "options": {"temperature": req.temperature},
    }
    if req.max_tokens is not None:
        payload["options"]["num_predict"] = req.max_tokens
    return payload


@router.get("/v1/models")
async def list_models() -> ModelsResponse:
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(_ollama_api_url("/api/tags"))
            resp.raise_for_status()
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Ollama unavailable: {e}")

    data = resp.json()
    models = [
        ModelInfo(id=m["name"], created=0, owned_by="local")
        for m in data.get("models", [])
    ]
    return ModelsResponse(data=models)


@router.post("/v1/chat/completions", response_model=None)
async def chat_completions(req: ChatCompletionRequest) -> ChatCompletionResponse | EventSourceResponse:
    # Free ASR/diarization models before ollama loads its model into RAM
    mem.acquire("ollama")

    payload = _build_ollama_payload(req)

    if req.stream:
        return EventSourceResponse(_stream_response(payload, req.model or settings.ollama_model))

    try:
        async with httpx.AsyncClient(timeout=600) as client:
            resp = await client.post(_ollama_api_url("/api/chat"), json=payload)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Ollama unavailable: {e}")

    if resp.status_code != 200:
        detail = resp.text or f"Ollama returned {resp.status_code}"
        raise HTTPException(status_code=502, detail=detail)

    data = resp.json()
    msg = data.get("message", {})
    completion_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"

    # Ollama thinking models may return content in "thinking" with empty "content"
    content = msg.get("content", "")
    if not content and msg.get("thinking"):
        content = msg["thinking"]

    return ChatCompletionResponse(
        id=completion_id,
        created=int(time.time()),
        model=req.model or settings.ollama_model,
        choices=[
            ChatCompletionChoice(
                index=0,
                message=ChatMessage(role=msg.get("role", "assistant"), content=content),
                finish_reason="stop",
            )
        ],
        usage=Usage(
            prompt_tokens=data.get("prompt_eval_count", 0),
            completion_tokens=data.get("eval_count", 0),
            total_tokens=data.get("prompt_eval_count", 0) + data.get("eval_count", 0),
        ),
    )


async def _stream_response(payload: dict[str, Any], model: str) -> AsyncIterator[str]:
    import json

    completion_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    created = int(time.time())

    try:
        async with httpx.AsyncClient(timeout=300) as client:
            async with client.stream("POST", _ollama_api_url("/api/chat"), json=payload) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    chunk_data = json.loads(line)
                    msg = chunk_data.get("message", {})
                    content = msg.get("content", "")
                    done = chunk_data.get("done", False)

                    sse_chunk = {
                        "id": completion_id,
                        "object": "chat.completion.chunk",
                        "created": created,
                        "model": model,
                        "choices": [
                            {
                                "index": 0,
                                "delta": {"content": content} if content else {},
                                "finish_reason": "stop" if done else None,
                            }
                        ],
                    }
                    yield json.dumps(sse_chunk)

                    if done:
                        yield "[DONE]"
    except httpx.HTTPError as e:
        error = {"error": {"message": f"Ollama stream error: {e}", "type": "server_error"}}
        yield json.dumps(error)
