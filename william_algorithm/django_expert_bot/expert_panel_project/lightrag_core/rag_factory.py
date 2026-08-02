import argparse
import asyncio
import os
from pathlib import Path
from functools import partial
try:
    from raganything import RAGAnything
    from lightrag import LightRAG
    from lightrag.llm.openai import openai_complete_if_cache, openai_embed
    from lightrag.utils import EmbeddingFunc
except ImportError:
    # Mock classes for development if dependencies are missing
    print("WARNING: lightrag or raganything not found. Using Mock classes.")
    
    class RAGAnything:
        def __init__(self, *args, **kwargs): pass
        async def process_document_complete(self, *args, **kwargs): pass
        async def aquery_with_multimodal(self, query, mode):
            return f"[MOCK RAG ANSWER] Knowledge about '{query}'"

    class LightRAG:
        def __init__(self, *args, **kwargs): pass
        async def initialize_storages(self): pass

    class EmbeddingFunc:
        def __init__(self, *args, **kwargs): pass
    
    def openai_complete_if_cache(*args, **kwargs): return "Mock completion"
    def openai_embed(*args, **kwargs): pass

# ----------------------------
# Config
# ----------------------------
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY not set. Run: export OPENAI_API_KEY=...")

DEFAULT_WORKING_DIR = "./lightrag_storage"
DEFAULT_OUTPUT_DIR = "./output"

# ----------------------------
# Build / Load RAG stack
# ----------------------------
async def build_rag(working_dir: str) -> RAGAnything:
    """Load (or create) LightRAG storages under working_dir, then wrap with RAGAnything."""
    wd = Path(working_dir)
    if wd.exists() and any(wd.iterdir()):
        print(f"✅ Found existing LightRAG instance, loading: {working_dir}")
    else:
        print(f"❌ No existing LightRAG instance found, will create new one: {working_dir}")

    lightrag_instance = LightRAG(
        working_dir=str(wd),
        llm_model_func=lambda prompt, system_prompt=None, history_messages=None, **kwargs: openai_complete_if_cache(
            "gpt-4o-mini",
            prompt,
            system_prompt=system_prompt,
            history_messages=history_messages or [],
            api_key=OPENAI_API_KEY,
            **kwargs,
        ),
        embedding_func=EmbeddingFunc(
            embedding_dim=3072,
            max_token_size=8192,
            model_name="text-embedding-3-large",
            func=partial(
                openai_embed.func,
                model="text-embedding-3-large",
                api_key=OPENAI_API_KEY,
            ),
        ),
    )

    # Load/create storages (graph, vdb, kv, caches...)
    await lightrag_instance.initialize_storages()
    # Wrap with RAGAnything (for multimodal doc parsing + query)
    rag = RAGAnything(
        lightrag=lightrag_instance,
        vision_model_func=lambda prompt, system_prompt=None, history_messages=None, image_data=None, **kwargs: (
            openai_complete_if_cache(
                "gpt-4o",
                "",
                system_prompt=None,
                history_messages=[],
                messages=[
                    {"role": "system", "content": system_prompt or ""},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {"url": f"data:image/jpeg;base64,{image_data}"},
                            },
                        ],
                    },
                ],
                api_key=OPENAI_API_KEY,
                **kwargs,
            )
            if image_data
            else openai_complete_if_cache(
                "gpt-4o-mini",
                prompt,
                system_prompt=system_prompt,
                history_messages=history_messages or [],
                api_key=OPENAI_API_KEY,
                **kwargs,
            )
        ),
    )
    return rag


from typing import Optional

# ----------------------------
# Ingest
# ----------------------------
def iter_files(path: str):
    """Yield files from a single file path or a directory (recursive)."""
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"Input path not found: {path}")
    if p.is_file():
        yield p
        return

    # directory
    exts = {".pdf", ".txt", ".md", ".docx", ".pptx", ".csv", ".png", ".jpg", ".jpeg"}
    for f in p.rglob("*"):
        if f.is_file() and f.suffix.lower() in exts:
            yield f


async def ingest(input_path: str, working_dir: str, output_dir: str, device: str = "cpu"):
    rag = await build_rag(working_dir)

    files = list(iter_files(input_path))
    if not files:
        print(f"⚠️ No supported files found under: {input_path}")
        return

    print(f"📥 Ingesting {len(files)} file(s) into knowledge base: {working_dir}")
    for f in files:
        print(f"  - {f}")
        await rag.process_document_complete(
            file_path=str(f),
            output_dir=output_dir,
            device=device,
        )

    print("✅ Ingest complete.")


# ----------------------------
# Query
# ----------------------------
async def query(question: str, working_dir: str, mode: str = "mix", style_path: Optional[str] = None):
    rag = await build_rag(working_dir)

    result = await rag.aquery_with_multimodal(
        query=question,
        mode=mode,
    )
    if style_path:
        # Import rewrite_answer from the local package relative to this script
        try:
            from .style_rewrite import rewrite_answer
        except ImportError:
            # Fallback for CLI usage
            from style_rewrite import rewrite_answer

        result = rewrite_answer(result, style_path)
    # print(result)
    return result


# ----------------------------
# CLI
# ----------------------------
def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_ingest = sub.add_parser("ingest", help="Ingest one file or a directory into the knowledge base")
    p_ingest.add_argument("input", help="File path or directory path to ingest")
    p_ingest.add_argument("--working-dir", default=DEFAULT_WORKING_DIR)
    p_ingest.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)
    p_ingest.add_argument("--device", default="cpu", choices=["cpu", "cuda", "mps"])

    p_query = sub.add_parser("query", help="Query the existing knowledge base")
    p_query.add_argument("question", help="Your question")
    p_query.add_argument("--working-dir", default=DEFAULT_WORKING_DIR)
    p_query.add_argument("--mode", default="mix", choices=["local", "global", "hybrid", "naive", "mix", "bypass"])
    p_query.add_argument("--style-path", help="Path to style profile .txt (optional)")

    args = parser.parse_args()

    if args.cmd == "ingest":
        asyncio.run(ingest(args.input, args.working_dir, args.output_dir, device=args.device))
    elif args.cmd == "query":
        asyncio.run(query(args.question, args.working_dir, mode=args.mode, style_path=args.style_path))


if __name__ == "__main__":
    main()
