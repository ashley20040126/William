import argparse
import os
import pickle
import time
from pathlib import Path
from typing import List, Tuple
from dotenv import load_dotenv
load_dotenv()

from langchain_openai import ChatOpenAI, OpenAIEmbeddings
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import TextLoader, UnstructuredFileLoader
from langchain_community.vectorstores import FAISS
from langchain_community.retrievers import BM25Retriever
from langchain.retrievers import EnsembleRetriever, ContextualCompressionRetriever
from langchain.retrievers.document_compressors import LLMChainExtractor
from mental_kb import build_support_plan

def try_build_cohere_reranker():
    cohere_key = os.getenv("COHERE_API_KEY")
    if not cohere_key:
        return None
    try:
        from langchain_community.document_compressors import CohereRerank
        return CohereRerank(cohere_api_key=cohere_key, top_n=6)
    except Exception:
        return None


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_WORKING_DIR = "./rag_storage"
DEFAULT_ANSWER_PROMPT = BASE_DIR / "prompts" / "answer_prompt.txt"
DEFAULT_LLM_MODEL = os.getenv("RAG_LLM_MODEL", "gpt-4o-mini")
DEFAULT_EMBEDDING_MODEL = os.getenv("RAG_EMBEDDING_MODEL", "text-embedding-3-large")
DEFAULT_BM25_K = int(os.getenv("RAG_BM25_K", "10"))
DEFAULT_VECTOR_K = int(os.getenv("RAG_VECTOR_K", "10"))
DEFAULT_WEIGHT_BM25 = float(os.getenv("RAG_WEIGHT_BM25", "0.5"))
DEFAULT_WEIGHT_VECTOR = float(os.getenv("RAG_WEIGHT_VECTOR", "0.5"))
DEFAULT_STYLE_MODE = os.getenv("RAG_STYLE_MODE", "single_pass")


def _clean_env(value: str | None) -> str | None:
    cleaned = (value or "").strip()
    return cleaned or None


OPENAI_API_KEY = _clean_env(os.getenv("OPENAI_API_KEY"))
OPENAI_BASE_URL = _clean_env(os.getenv("OPENAI_BASE_URL")) or "https://api.openai.com/v1"

EXPERT_REGISTRY = {
    "li_songwei": "李松蔚",
    "luo_zhenyu": "罗振宇",
    "elon_musk": "Elon Musk",
    "李松蔚": "李松蔚",
    "罗振宇": "罗振宇",
    "ElonMusk": "Elon Musk"
}

def _get_real_name(name: str | None) -> str | None:
    if not name:
        return None
    return EXPERT_REGISTRY.get(name, name)

def _auto_working_dir(name: str | None) -> str:
    if name:
        return f"{DEFAULT_WORKING_DIR}/{name}"
    return DEFAULT_WORKING_DIR


def _auto_working_dir_from_input(input_path: str) -> str:
    p = Path(input_path)
    if p.is_dir():
        name = p.name
    else:
        name = p.parent.name
    return f"{DEFAULT_WORKING_DIR}/{name}"


def _auto_style_path(name: str | None) -> str | None:
    if not name:
        return None
    candidate = Path(DEFAULT_WORKING_DIR) / name / f"{name}_style.txt"
    return str(candidate) if candidate.exists() else None


def load_documents(data_dir: str) -> List[Document]:
    """最简单：读取 data_dir 下所有 .txt/.md。"""
    docs: List[Document] = []
    base = Path(data_dir)
    for p in base.rglob("*"):
        if p.is_dir():
            continue
        suffix = p.suffix.lower()
        if suffix in [".txt", ".md"]:
            docs.extend(TextLoader(str(p), encoding="utf-8").load())
        elif suffix in [".pdf", ".docx", ".pptx"]:
            docs.extend(UnstructuredFileLoader(str(p)).load())

    # 给每个 doc 加来源元数据，后面打印引用更清楚
    for d in docs:
        d.metadata.setdefault("source", d.metadata.get("source", "unknown"))
    return docs


def _split_documents(docs: List[Document]) -> List[Document]:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=400,
        chunk_overlap=60,
        separators=["\n\n", "\n", "。", ".", " ", ""],
    )
    return splitter.split_documents(docs)


def _save_chunks(chunks: List[Document], working_dir: str) -> None:
    Path(working_dir).mkdir(parents=True, exist_ok=True)
    with open(Path(working_dir) / "chunks.pkl", "wb") as f:
        pickle.dump(chunks, f)


def _load_chunks(working_dir: str) -> List[Document]:
    with open(Path(working_dir) / "chunks.pkl", "rb") as f:
        return pickle.load(f)


def build_hybrid_retriever(
    chunks: List[Document],
    embeddings: OpenAIEmbeddings,
    bm25_k: int = 10,
    vector_k: int = 10,
    weights: Tuple[float, float] = (0.5, 0.5),
    working_dir: str | None = None,
) -> EnsembleRetriever:
    """Hybrid = BM25 + Vector(FAISS) -> EnsembleRetriever"""
    bm25 = BM25Retriever.from_documents(chunks)
    bm25.k = bm25_k

    if working_dir:
        vdb = FAISS.load_local(working_dir, embeddings, allow_dangerous_deserialization=True)
    else:
        vdb = FAISS.from_documents(chunks, embeddings)
    vec = vdb.as_retriever(search_kwargs={"k": vector_k})

    hybrid = EnsembleRetriever(retrievers=[bm25, vec], weights=list(weights))
    return hybrid


def build_retriever_with_rerank_and_compression(
    base_retriever,
    llm: ChatOpenAI,
):
    """
    组合策略（最稳）：
    - 先 hybrid 召回（宁可多一点）
    - 再 rerank（如果可用）
    - 再 compression（抽取式压缩，只保留相关句子）
    """
    # 1) rerank（可选）
    cohere_rerank = try_build_cohere_reranker()
    if cohere_rerank:
        # 只做 rerank，不做 LLM compression
        return ContextualCompressionRetriever(
            base_retriever=base_retriever,
            base_compressor=cohere_rerank,
        )

    # 没有 rerank 就不做 compression
    return base_retriever


def _load_answer_prompt() -> str:
    return DEFAULT_ANSWER_PROMPT.read_text(encoding="utf-8")


def answer_question(
    llm: ChatOpenAI,
    retriever,
    query: str,
    name: str | None,
    style_profile: str | None = None,
    *,
    memory_context: str = "",
    recent_messages: list[dict] | None = None,
    verbose: bool = False,
) -> tuple[str, str, dict]:
    """最简单的 RAG 生成：检索 -> 拼 prompt -> 生成 -> 带引用"""
    t = time.time()
    docs = retriever.invoke(query)
    if verbose:
        print("retrieve+compress:", time.time() - t, "docs:", len(docs))

    # 拼上下文（压缩后通常会更短更干净）
    context = "\n\n---\n\n".join(
        [f"[{i+1}] SOURCE={d.metadata.get('source','unknown')}\n{d.page_content}" for i, d in enumerate(docs)]
    )
    support_plan = build_support_plan(
        query=query,
        memory_context=memory_context,
        recent_messages=recent_messages,
    ).as_dict()

    prompt = _load_answer_prompt().format(context=context, query=query, name=name or "该说话者")
    if support_plan.get("context"):
        prompt += (
            "\n\nMENTAL HEALTH SUPPORT GUIDANCE:\n"
            f"{support_plan['context']}\n"
            "Treat this as higher-priority guidance for how to respond professionally and safely."
        )
        if support_plan.get("selected_module_id") == "difficult_conversation":
            prompt += (
                "\n\nRESPONSE FORMAT REQUIREMENT:\n"
                "For this turn, keep the reply to 2 or 3 sentences, and ask at most one question. "
                "Use at most one question mark in the final answer. Do not give multiple parallel questions. "
                "Make sure the final reply clearly touches at least one of these: "
                "the reaction they fear, the one sentence they most want the other person to hear, "
                "or a possible opening line."
            )
        if support_plan.get("risk_level") in {"imminent", "high", "moderate"}:
            prompt += (
                "\n\nSAFETY OUTPUT REQUIREMENT:\n"
                "You must explicitly mention the concrete human support resource from the safety guidance. "
                "If the guidance includes 988, mention 988 in the final reply. "
                "Do not switch back into normal exploratory coaching before the handoff is clear."
            )
    if memory_context:
        prompt += (
            "\n\nCONVERSATION MEMORY:\n"
            f"{memory_context}\n"
            "Use this as supporting context for continuity. Prioritize it when it helps maintain a coherent multi-turn conversation. "
            "If the user asks what you remember, answer those remembered facts directly before expanding."
        )
    if recent_messages:
        transcript = "\n".join(
            f"{'User' if message.get('role') == 'user' else 'Assistant'}: {message.get('content', '').strip()}"
            for message in recent_messages
            if message.get("content")
        )
        if transcript:
            prompt += (
                "\n\nRECENT CONVERSATION:\n"
                f"{transcript}\n"
                "Stay consistent with this recent exchange and answer as the next turn in the same conversation."
            )
    if style_profile:
        prompt += (
            "\n\nSTYLE PROFILE:\n"
            f"{style_profile}\n\n"
            "Follow the style profile while keeping the answer grounded in the retrieved context. "
            "Use first person when answering as the target speaker."
        )

    t = time.time()
    resp = llm.invoke(prompt)
    if verbose:
        print("llm_invoke:", time.time() - t)
    answer = resp.content

    refs = []
    for i, d in enumerate(docs):
        refs.append(
            f"[{i+1}] SOURCE={d.metadata.get('source','unknown')}\n"
            f"{d.page_content.strip()}"
        )

    return answer, "\n\n".join(refs), support_plan


def resolve_query_paths(
    name: str | None,
    working_dir: str | None = None,
    style_path: str | None = None,
) -> tuple[str, str | None, str | None]:
    resolved_working_dir = working_dir or _auto_working_dir(name)
    resolved_style_path = style_path or _auto_style_path(name)
    real_name = _get_real_name(name)
    return resolved_working_dir, resolved_style_path, real_name


def load_query_runtime(
    *,
    name: str | None,
    working_dir: str | None = None,
    style_path: str | None = None,
    bm25_k: int = DEFAULT_BM25_K,
    vector_k: int = DEFAULT_VECTOR_K,
    weights: Tuple[float, float] = (DEFAULT_WEIGHT_BM25, DEFAULT_WEIGHT_VECTOR),
    llm_model: str = DEFAULT_LLM_MODEL,
    embedding_model: str = DEFAULT_EMBEDDING_MODEL,
    style_mode: str = DEFAULT_STYLE_MODE,
):
    resolved_working_dir, resolved_style_path, real_name = resolve_query_paths(
        name=name,
        working_dir=working_dir,
        style_path=style_path,
    )
    chunks = _load_chunks(resolved_working_dir)
    if not chunks:
        raise RuntimeError(f"No chunks found in {resolved_working_dir}. Run ingest first.")

    llm_kwargs = {
        "model": llm_model,
        "temperature": 0,
    }
    embedding_kwargs = {
        "model": embedding_model,
    }
    if OPENAI_API_KEY:
        llm_kwargs["api_key"] = OPENAI_API_KEY
        embedding_kwargs["api_key"] = OPENAI_API_KEY
    if OPENAI_BASE_URL:
        llm_kwargs["base_url"] = OPENAI_BASE_URL
        embedding_kwargs["base_url"] = OPENAI_BASE_URL

    llm = ChatOpenAI(**llm_kwargs)
    embeddings = OpenAIEmbeddings(**embedding_kwargs)
    hybrid = build_hybrid_retriever(
        chunks,
        embeddings,
        bm25_k=bm25_k,
        vector_k=vector_k,
        weights=weights,
        working_dir=resolved_working_dir,
    )
    retriever = build_retriever_with_rerank_and_compression(
        base_retriever=hybrid,
        llm=llm,
    )

    return {
        "name": name,
        "real_name": real_name,
        "working_dir": resolved_working_dir,
        "style_path": resolved_style_path,
        "style_mode": style_mode,
        "style_profile": (
            Path(resolved_style_path).read_text(encoding="utf-8")
            if resolved_style_path and style_mode == "single_pass"
            else None
        ),
        "llm": llm,
        "retriever": retriever,
    }


def run_query(
    runtime,
    question: str,
    *,
    memory_context: str = "",
    recent_messages: list[dict] | None = None,
    verbose: bool = False,
) -> tuple[str, str, dict]:
    answer, refs, support_plan = answer_question(
        runtime["llm"],
        runtime["retriever"],
        question,
        runtime["real_name"],
        runtime.get("style_profile"),
        memory_context=memory_context,
        recent_messages=recent_messages,
        verbose=verbose,
    )
    if runtime["style_path"] and runtime.get("style_mode") == "rewrite":
        from style_rewrite import rewrite_answer

        answer = rewrite_answer(
            answer,
            runtime["style_path"],
            name=runtime["real_name"],
        )
    return answer, refs, support_plan


def ingest(input_dir: str, working_dir: str) -> None:
    docs = load_documents(input_dir)
    if not docs:
        raise RuntimeError(f"No documents found in {input_dir}. Put .txt/.md files there.")

    chunks = _split_documents(docs)
    _save_chunks(chunks, working_dir)

    embeddings = OpenAIEmbeddings(model="text-embedding-3-large")
    vdb = FAISS.from_documents(chunks, embeddings)
    vdb.save_local(working_dir)

    print(f"✅ Ingest complete. Stored index at: {working_dir}")


def query(
    question: str,
    working_dir: str,
    bm25_k: int,
    vector_k: int,
    weights: Tuple[float, float],
    style_path: str | None,
    name: str | None,
) -> None:
    runtime = load_query_runtime(
        name=name,
        working_dir=working_dir,
        style_path=style_path,
        bm25_k=bm25_k,
        vector_k=vector_k,
        weights=weights,
    )
    answer, refs, support_plan = run_query(runtime, question, verbose=True)
    print("\n=== Answer ===\n")
    print(answer)
    print("\n=== Support Plan ===\n")
    print(json.dumps(support_plan, ensure_ascii=False, indent=2))
    print("\n=== References ===\n")
    print(refs)


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_ingest = sub.add_parser("ingest", help="Ingest a folder of documents")
    p_ingest.add_argument("input", help="Directory path to ingest")
    p_ingest.add_argument("--name", help="Profile name to auto-build working dir (optional)")
    p_ingest.add_argument("--working-dir")

    p_query = sub.add_parser("query", help="Query the index")
    p_query.add_argument("question", help="Your question")
    p_query.add_argument("--name", help="Profile name to auto-build working dir (optional)")
    p_query.add_argument("--working-dir")
    p_query.add_argument("--bm25-k", type=int, default=10)
    p_query.add_argument("--vector-k", type=int, default=10)
    p_query.add_argument("--weight-bm25", type=float, default=0.5)
    p_query.add_argument("--weight-vector", type=float, default=0.5)
    p_query.add_argument("--style-path", help="Path to style profile .txt (optional)")

    args = parser.parse_args()

    if args.cmd == "ingest":
        working_dir = args.working_dir or _auto_working_dir(args.name)
        if working_dir == DEFAULT_WORKING_DIR:
            working_dir = _auto_working_dir_from_input(args.input)
        ingest(args.input, working_dir)
    elif args.cmd == "query":
        working_dir = args.working_dir or _auto_working_dir(args.name)
        style_path = args.style_path or _auto_style_path(args.name)
        query(
            args.question,
            working_dir,
            bm25_k=args.bm25_k,
            vector_k=args.vector_k,
            weights=(args.weight_bm25, args.weight_vector),
            style_path=style_path,
            name=args.name,
        )


if __name__ == "__main__":
    main()
