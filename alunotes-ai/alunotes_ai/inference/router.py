"""OpenAI-compatible inference router that proxies to a configurable upstream.

The upstream can be any OpenAI-compatible `/v1` endpoint: openai.com, groq,
vllm, llama-cpp-server, LiteLLM, a local ollama instance with its `/v1` shim,
etc. Configured via `ALUNOTES_AI_OPENAI_BASE_URL` / `_API_KEY` / `_MODEL`.
"""

from typing import Any, AsyncIterator

from fastapi import APIRouter, HTTPException
from openai import APIError, AsyncOpenAI
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


_client = AsyncOpenAI(
    base_url=settings.openai_base_url,
    api_key=settings.openai_api_key,
)


def _request_kwargs(req: ChatCompletionRequest) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "model": req.model or settings.openai_model,
        "messages": [{"role": m.role, "content": m.content} for m in req.messages],
        "temperature": req.temperature,
    }
    if req.max_tokens is not None:
        kwargs["max_tokens"] = req.max_tokens
    return kwargs


@router.get("/v1/models")
async def list_models() -> dict[str, Any]:
    try:
        resp = await _client.models.list()
    except APIError as e:
        raise HTTPException(status_code=502, detail=f"upstream error: {e}")
    return {"object": "list", "data": [m.model_dump() for m in resp.data]}


@router.post("/v1/chat/completions", response_model=None)
async def chat_completions(req: ChatCompletionRequest) -> dict[str, Any] | EventSourceResponse:
    # Free ASR/diarization models before the LLM runs (if local)
    mem.acquire("llm")

    if req.stream:
        return EventSourceResponse(_stream(req))

    try:
        completion = await _client.chat.completions.create(**_request_kwargs(req))
    except APIError as e:
        raise HTTPException(status_code=502, detail=f"upstream error: {e}")

    return completion.model_dump()


async def _stream(req: ChatCompletionRequest) -> AsyncIterator[str]:
    import json

    try:
        stream = await _client.chat.completions.create(**_request_kwargs(req), stream=True)
        async for chunk in stream:
            yield json.dumps(chunk.model_dump())
        yield "[DONE]"
    except APIError as e:
        yield json.dumps({"error": {"message": f"upstream stream error: {e}", "type": "server_error"}})
