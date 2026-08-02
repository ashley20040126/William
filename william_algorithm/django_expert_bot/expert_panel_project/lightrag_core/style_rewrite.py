import argparse
import os
import sys
from pathlib import Path

from lightrag.llm.openai import openai_complete_if_cache

# ----------------------------
# Config
# ----------------------------
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY not set. Run: export OPENAI_API_KEY=...")

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_STYLE_SYSTEM = BASE_DIR / "prompts" / "style_system_prompt.txt"
DEFAULT_STYLE_USER = BASE_DIR / "prompts" / "style_user_prompt.txt"
DEFAULT_REWRITE_PROMPT = BASE_DIR / "prompts" / "rewrite_prompt.txt"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _read_input_text(input_path: str) -> str:
    if input_path == "-":
        return sys.stdin.read()
    return Path(input_path).read_text(encoding="utf-8")


def extract_style(
    chat_log_text: str,
    output_path: str,
    style_system_path: str = str(DEFAULT_STYLE_SYSTEM),
    style_user_path: str = str(DEFAULT_STYLE_USER),
    model: str = "gpt-4o-mini",
) -> str:
    system_prompt = _read_text(Path(style_system_path))
    user_prompt_template = _read_text(Path(style_user_path))
    user_prompt = user_prompt_template.replace("{CHAT_LOG_TEXT}", chat_log_text)

    result = openai_complete_if_cache(
        model,
        user_prompt,
        system_prompt=system_prompt,
        history_messages=[],
        api_key=OPENAI_API_KEY,
    )

    out_path = Path(output_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(result, encoding="utf-8")
    return result


def rewrite_answer(
    answer_text: str,
    style_path: str,
    rewrite_prompt_path: str = str(DEFAULT_REWRITE_PROMPT),
    model: str = "gpt-4o-mini",
) -> str:
    style_profile = _read_text(Path(style_path))
    rewrite_system = _read_text(Path(rewrite_prompt_path))

    user_prompt = (
        "Style profile:\n<<<\n"
        f"{style_profile}\n"
        ">>>\n\n"
        "Original answer:\n<<<\n"
        f"{answer_text}\n"
        ">>>\n\n"
        "Return ONLY the rewritten answer."
    )

    result = openai_complete_if_cache(
        model,
        user_prompt,
        system_prompt=rewrite_system,
        history_messages=[],
        api_key=OPENAI_API_KEY,
    )
    return result


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_extract = sub.add_parser("extract", help="Extract speaking style from chat logs")
    p_extract.add_argument("chat_log", help="Path to chat log text file, or '-' for stdin")
    p_extract.add_argument("--output", required=True, help="Output path for style profile .txt")
    p_extract.add_argument("--style-system", default=str(DEFAULT_STYLE_SYSTEM))
    p_extract.add_argument("--style-user", default=str(DEFAULT_STYLE_USER))
    p_extract.add_argument("--model", default="gpt-4o-mini")

    p_rewrite = sub.add_parser("rewrite", help="Rewrite an answer using a style profile")
    p_rewrite.add_argument("answer", help="Path to answer text file, or '-' for stdin")
    p_rewrite.add_argument("--style-path", required=True, help="Path to style profile .txt")
    p_rewrite.add_argument("--rewrite-prompt", default=str(DEFAULT_REWRITE_PROMPT))
    p_rewrite.add_argument("--model", default="gpt-4o-mini")

    args = parser.parse_args()

    if args.cmd == "extract":
        chat_log_text = _read_input_text(args.chat_log)
        extract_style(
            chat_log_text=chat_log_text,
            output_path=args.output,
            style_system_path=args.style_system,
            style_user_path=args.style_user,
            model=args.model,
        )
    elif args.cmd == "rewrite":
        answer_text = _read_input_text(args.answer)
        rewritten = rewrite_answer(
            answer_text=answer_text,
            style_path=args.style_path,
            rewrite_prompt_path=args.rewrite_prompt,
            model=args.model,
        )
        print(rewritten)


if __name__ == "__main__":
    main()
