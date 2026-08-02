import asyncio
import os
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")

import rag
from support_guidance import build_support_guidance

DEFAULT_EXPERT = os.getenv("RAG_DEFAULT_EXPERT", "li_songwei").strip() or "li_songwei"
PRELOAD_EXPERTS = [
    expert.strip()
    for expert in os.getenv("RAG_PRELOAD_EXPERTS", DEFAULT_EXPERT).split(",")
    if expert.strip()
]
SERVICE_HOST = os.getenv("RAG_SERVICE_HOST", "127.0.0.1")
SERVICE_PORT = int(os.getenv("RAG_SERVICE_PORT", "8000"))

_runtime_cache: dict[str, dict[str, Any]] = {}
_runtime_locks: dict[str, asyncio.Lock] = {}


def _normalize_expert(expert: str | None) -> str:
    return (expert or DEFAULT_EXPERT).strip() or DEFAULT_EXPERT


async def _get_runtime(expert: str) -> dict[str, Any]:
    normalized = _normalize_expert(expert)
    cached = _runtime_cache.get(normalized)
    if cached:
        return cached

    lock = _runtime_locks.setdefault(normalized, asyncio.Lock())
    async with lock:
        cached = _runtime_cache.get(normalized)
        if cached:
            return cached

        runtime = await asyncio.to_thread(rag.load_query_runtime, name=normalized)
        _runtime_cache[normalized] = runtime
        return runtime


async def _preload_experts() -> None:
    for expert in PRELOAD_EXPERTS:
        started_at = time.perf_counter()
        await _get_runtime(expert)
        elapsed = time.perf_counter() - started_at
        print(f"[RAG Service] Preloaded expert={expert} in {elapsed:.2f}s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await _preload_experts()
    yield


app = FastAPI(title="William RAG Service", lifespan=lifespan)


class ConversationMessage(BaseModel):
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str = Field(..., min_length=1, max_length=4000)


class QueryRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)
    expert: str | None = None
    memory_context: str = Field(default="", max_length=12000)
    recent_messages: list[ConversationMessage] = Field(default_factory=list)


class QueryResponse(BaseModel):
    answer: str
    expert: str
    elapsed: float
    support: dict[str, Any] | None = None


class RetrieveRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)
    expert: str | None = None
    k: int = 5


class DocumentResponse(BaseModel):
    content: str
    source: str


class RetrieveResponse(BaseModel):
    documents: list[DocumentResponse]
    expert: str
    elapsed: float


class SupportGuideRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)
    memory_context: str = Field(default="", max_length=12000)
    recent_messages: list[ConversationMessage] = Field(default_factory=list)
    retrieval_intent: str = Field(default="general_support", max_length=120)
    user_stance: str = Field(default="neutral", max_length=120)


@app.post("/query", response_model=QueryResponse)
async def handle_query(request: QueryRequest):
    started_at = time.perf_counter()
    expert = _normalize_expert(request.expert)

    try:
        runtime = await _get_runtime(expert)
        answer, _, support = await asyncio.to_thread(
            rag.run_query,
            runtime,
            request.text,
            memory_context=request.memory_context,
            recent_messages=[message.model_dump() for message in request.recent_messages],
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        print(f"[RAG Service] Query failed for expert={expert}: {exc}")
        raise HTTPException(status_code=500, detail="RAG query failed") from exc

    elapsed = time.perf_counter() - started_at
    return QueryResponse(answer=answer, expert=expert, elapsed=round(elapsed, 3), support=support)


@app.post("/retrieve", response_model=RetrieveResponse)
async def handle_retrieve(request: RetrieveRequest):
    started_at = time.perf_counter()
    expert = _normalize_expert(request.expert)

    try:
        runtime = await _get_runtime(expert)
        # We call the retriever directly from runtime
        docs = await asyncio.to_thread(runtime["retriever"].invoke, request.text)
        # Limit to k documents
        docs = docs[:request.k]
        
        results = [
            DocumentResponse(
                content=d.page_content,
                source=d.metadata.get("source", "unknown")
            )
            for d in docs
        ]
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        print(f"[RAG Service] Retrieve failed for expert={expert}: {exc}")
        raise HTTPException(status_code=500, detail="RAG retrieve failed") from exc

    elapsed = time.perf_counter() - started_at
    return RetrieveResponse(documents=results, expert=expert, elapsed=round(elapsed, 3))


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "default_expert": DEFAULT_EXPERT,
        "preload_experts": PRELOAD_EXPERTS,
        "loaded_experts": sorted(_runtime_cache.keys()),
    }


@app.post("/support/guide")
async def support_guide(request: SupportGuideRequest):
    try:
        return build_support_guidance(
            query=request.text,
            memory_context=request.memory_context,
            recent_messages=[message.model_dump() for message in request.recent_messages],
            retrieval_intent=request.retrieval_intent,
            user_stance=request.user_stance,
        )
    except Exception as exc:
        print(f"[RAG Service] Support guidance failed: {exc}")
        raise HTTPException(status_code=500, detail="Support guidance failed") from exc


@app.get("/experts")
async def experts():
    return {
        "default_expert": DEFAULT_EXPERT,
        "preload_experts": PRELOAD_EXPERTS,
        "loaded_experts": sorted(_runtime_cache.keys()),
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host=SERVICE_HOST, port=SERVICE_PORT)
