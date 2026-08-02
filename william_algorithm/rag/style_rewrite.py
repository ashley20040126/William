import argparse
import asyncio
import os
import sys
from pathlib import Path

from openai import OpenAI

# ----------------------------
# Config
# ----------------------------
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY not set. Run: export OPENAI_API_KEY=...")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL")
_client = OpenAI(api_key=OPENAI_API_KEY, base_url=OPENAI_BASE_URL)

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_WORKING_DIR = Path("./rag_storage")
DEFAULT_STYLE_SYSTEM = BASE_DIR / "prompts" / "style_system_prompt.txt"
DEFAULT_STYLE_USER = BASE_DIR / "prompts" / "style_user_prompt.txt"
DEFAULT_REWRITE_PROMPT = BASE_DIR / "prompts" / "rewrite_prompt.txt"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _read_input_text(input_path: str) -> str:
    if input_path == "-":
        return sys.stdin.read()
    return Path(input_path).read_text(encoding="utf-8")


def _auto_style_output(name: str) -> str:
    return str(DEFAULT_WORKING_DIR / name / f"{name}_style.txt")


def _complete(model: str, system_prompt: str, user_prompt: str) -> str:
    resp = _client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    return resp.choices[0].message.content or ""


async def _complete_async(model: str, system_prompt: str, user_prompt: str) -> str:
    return await asyncio.to_thread(_complete, model, system_prompt, user_prompt)


async def extract_style_async(
    chat_log_text: str,
    output_path: str,
    style_system_path: str = str(DEFAULT_STYLE_SYSTEM),
    style_user_path: str = str(DEFAULT_STYLE_USER),
    model: str = "gpt-4o-mini",
    name: str | None = None,
) -> str:
    system_prompt = _read_text(Path(style_system_path))
    user_prompt_template = _read_text(Path(style_user_path))
    identity_hint = f"\n\nTarget speaker: {name}\nExtract this person's speaking style." if name else ""
    user_prompt = user_prompt_template.replace("{CHAT_LOG_TEXT}", chat_log_text) + identity_hint

    result = await _complete_async(model, system_prompt, user_prompt)

    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(result, encoding="utf-8")
    return result


def extract_style(
    chat_log_text: str,
    output_path: str,
    style_system_path: str = str(DEFAULT_STYLE_SYSTEM),
    style_user_path: str = str(DEFAULT_STYLE_USER),
    model: str = "gpt-4o-mini",
    name: str | None = None,
) -> str:
    try:
        asyncio.get_running_loop()
        raise RuntimeError("extract_style() cannot run inside an event loop; use extract_style_async().")
    except RuntimeError as exc:
        if "no running event loop" in str(exc).lower():
            return asyncio.run(
                extract_style_async(
                    chat_log_text=chat_log_text,
                    output_path=output_path,
                    style_system_path=style_system_path,
                    style_user_path=style_user_path,
                    model=model,
                    name=name,
                )
            )
        raise


async def rewrite_answer_async(
    answer_text: str,
    style_path: str,
    rewrite_prompt_path: str = str(DEFAULT_REWRITE_PROMPT),
    model: str = "gpt-4o-mini",
    name: str | None = None,
) -> str:
    style_profile = _read_text(Path(style_path))
    rewrite_system = _read_text(Path(rewrite_prompt_path))

    identity_hint = (
        f"\n\nIdentity:\nYou are {name}. "
        "You must answer in first person only. "
        "Do not use third-person pronouns (他/她/他们) or third-person phrasing."
        if name
        else ""
    )
    user_prompt = (
        "Style profile:\n<<<\n"
        f"{style_profile}\n"
        ">>>\n\n"
        "Original answer:\n<<<\n"
        f"{answer_text}\n"
        ">>>\n"
        f"{identity_hint}\n\n"
        "Return ONLY the rewritten answer."
    )

    system_prompt = rewrite_system + (
        f"\n\nYou are {name}. You must answer in first person only." if name else ""
    )
    return await _complete_async(model, system_prompt, user_prompt)


def rewrite_answer(
    answer_text: str,
    style_path: str,
    rewrite_prompt_path: str = str(DEFAULT_REWRITE_PROMPT),
    model: str = "gpt-4o-mini",
    name: str | None = None,
) -> str:
    try:
        asyncio.get_running_loop()
        raise RuntimeError("rewrite_answer() cannot run inside an event loop; use rewrite_answer_async().")
    except RuntimeError as exc:
        if "no running event loop" in str(exc).lower():
            return asyncio.run(
                rewrite_answer_async(
                    answer_text=answer_text,
                    style_path=style_path,
                    rewrite_prompt_path=rewrite_prompt_path,
                    model=model,
                    name=name,
                )
            )
        raise


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_extract = sub.add_parser("extract", help="Extract speaking style from chat logs")
    p_extract.add_argument("chat_log", help="Path to chat log text file, or '-' for stdin")
    p_extract.add_argument("--output", help="Output path for style profile .txt")
    p_extract.add_argument("--name", help="Profile name to auto-build output path (optional)")
    p_extract.add_argument("--style-system", default=str(DEFAULT_STYLE_SYSTEM))
    p_extract.add_argument("--style-user", default=str(DEFAULT_STYLE_USER))
    p_extract.add_argument("--model", default="gpt-4o-mini")

    p_rewrite = sub.add_parser("rewrite", help="Rewrite an answer using a style profile")
    p_rewrite.add_argument("answer", help="Path to answer text file, or '-' for stdin")
    p_rewrite.add_argument("--style-path", required=True, help="Path to style profile .txt")
    p_rewrite.add_argument("--name", help="Name/persona to enforce first-person rewrite")
    p_rewrite.add_argument("--rewrite-prompt", default=str(DEFAULT_REWRITE_PROMPT))
    p_rewrite.add_argument("--model", default="gpt-4o-mini")

    args = parser.parse_args()

    if args.cmd == "extract":
        chat_log_text = _read_input_text(args.chat_log)
        output_path = args.output
        if not output_path:
            if not args.name:
                parser.error("extract requires --output or --name")
            output_path = _auto_style_output(args.name)
        extract_style(
            chat_log_text=chat_log_text,
            output_path=output_path,
            style_system_path=args.style_system,
            style_user_path=args.style_user,
            model=args.model,
            name=args.name,
        )
    elif args.cmd == "rewrite":
        answer_text = _read_input_text(args.answer)
        rewritten = rewrite_answer(
            answer_text=answer_text,
            style_path=args.style_path,
            rewrite_prompt_path=args.rewrite_prompt,
            model=args.model,
            name=args.name,
        )
        print(rewritten)


if __name__ == "__main__":
    main()
