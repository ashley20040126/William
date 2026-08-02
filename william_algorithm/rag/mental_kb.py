import json
import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

BASE_DIR = Path(__file__).resolve().parent
KB_DIR = BASE_DIR / "mental_kb"
SAFETY_POLICY_PATH = KB_DIR / "safety" / "risk_policy.json"
MODULES_DIR = KB_DIR / "modules"


@dataclass
class SupportPlan:
    risk_level: str = "low"
    response_mode: str = "reflective_support"
    risk_matches: list[str] | None = None
    selected_module_id: str | None = None
    selected_module_name: str | None = None
    confidence: float = 0.0
    matched_terms: list[str] | None = None
    context: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "risk_level": self.risk_level,
            "response_mode": self.response_mode,
            "risk_matches": self.risk_matches or [],
            "selected_module_id": self.selected_module_id,
            "selected_module_name": self.selected_module_name,
            "confidence": round(self.confidence, 3),
            "matched_terms": self.matched_terms or [],
            "context": self.context,
        }


def _read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_safety_policy() -> dict[str, Any]:
    return _read_json(SAFETY_POLICY_PATH)


@lru_cache(maxsize=1)
def load_modules() -> list[dict[str, Any]]:
    return [
        _read_json(path)
        for path in sorted(MODULES_DIR.glob("*.json"))
    ]


def _normalize_text(text: str) -> str:
    lowered = text.lower()
    lowered = re.sub(r"\s+", " ", lowered)
    return lowered


def _collect_text(
    query: str,
    memory_context: str = "",
    recent_messages: list[dict] | None = None,
) -> str:
    parts = [query or "", memory_context or ""]
    if recent_messages:
        parts.extend(message.get("content", "") for message in recent_messages[-6:])
    return _normalize_text("\n".join(part for part in parts if part))


def detect_risk_signals(
    query: str,
    memory_context: str = "",
    recent_messages: list[dict] | None = None,
) -> tuple[str, str, list[str]]:
    text = _collect_text(query, memory_context, recent_messages)
    policy = load_safety_policy()
    ordered_levels = ["imminent", "high", "moderate"]

    for level in ordered_levels:
        level_policy = policy["levels"][level]
        matches = [
            keyword
            for keyword in level_policy.get("keywords", [])
            if keyword and keyword.lower() in text
        ]
        if matches:
            return level, level_policy.get("response_mode", "reflective_support"), matches

    return "low", "reflective_support", []


def _score_module(module: dict[str, Any], text: str) -> tuple[float, list[str]]:
    score = 0.0
    matches: list[str] = []

    for keyword in module.get("keywords", []):
        normalized = keyword.lower()
        if normalized and normalized in text:
            score += 1.0 if len(normalized) <= 4 else 1.4
            matches.append(keyword)

    module_id = module.get("module_id")
    if module_id == "difficult_conversation":
        if any(token in text for token in ["开口", "怎么说", "说出口", "谈", "沟通", "conversation"]):
            score += 2.0
        if any(token in text for token in ["妈妈", "爸爸", "父母", "伴侣", "老板", "男朋友", "女朋友", "partner", "boss"]):
            score += 1.5
    elif module_id == "boundaries_relationship":
        if any(token in text for token in ["边界", "拒绝", "讨好", "委屈", "被消耗", "关系", "resentful", "people-pleasing", "set boundaries", "controlled"]):
            score += 2.0
    elif module_id == "sleep_disruption":
        if any(token in text for token in ["失眠", "睡不着", "早醒", "半夜醒", "insomnia", "很早就醒", "can't fall asleep", "mind keeps racing", "醒来", "一躺下"]):
            score += 2.0
        if all(token in text for token in ["晚上", "累", "躺下"]):
            score += 1.6
    elif module_id == "rumination":
        if any(token in text for token in ["反复想", "停不下来", "内耗", "想不通", "overthinking"]):
            score += 2.0
    elif module_id == "anxiety_escalation":
        if any(token in text for token in ["焦虑", "紧张", "panic", "心慌", "担心", "something bad is about to happen", "胸口发紧", "chest feels tight"]):
            score += 2.0
    elif module_id == "low_mood_inertia":
        if any(token in text for token in ["低落", "没力气", "提不起劲", "不想动", "无意义", "down", "动不起来", "pointless"]):
            score += 2.0

    return score, list(dict.fromkeys(matches))


def select_support_module(
    query: str,
    memory_context: str = "",
    recent_messages: list[dict] | None = None,
) -> tuple[dict[str, Any] | None, float, list[str]]:
    text = _collect_text(query, memory_context, recent_messages)
    best_module = None
    best_score = 0.0
    best_matches: list[str] = []

    for module in load_modules():
        score, matches = _score_module(module, text)
        if score > best_score:
            best_module = module
            best_score = score
            best_matches = matches

    if best_module is None or best_score < 2.0:
        return None, 0.0, []

    confidence = min(0.98, 0.45 + best_score / 10.0)
    return best_module, confidence, best_matches


def _format_sources(source_refs: list[dict[str, Any]]) -> str:
    if not source_refs:
        return ""
    return "\n".join(
        f"- {item.get('organization', 'Unknown')}: {item.get('title', 'Untitled')} ({item.get('url', '')})"
        for item in source_refs[:3]
    )


def build_support_plan(
    query: str,
    memory_context: str = "",
    recent_messages: list[dict] | None = None,
) -> SupportPlan:
    risk_level, response_mode, risk_matches = detect_risk_signals(query, memory_context, recent_messages)
    policy = load_safety_policy()

    if risk_level in {"imminent", "high", "moderate"}:
        crisis_lines = policy.get("resources", {})
        us_resource = crisis_lines.get("us_crisis_line", {})
        emergency = crisis_lines.get("emergency", {})
        context = (
            "【心理支持安全规则】\n"
            f"- 当前风险等级：{risk_level}\n"
            f"- 命中的风险信号：{', '.join(risk_matches)}\n"
            "- 先简短承接情绪与痛苦，再明确建议立刻联系真人支持。\n"
            "- 如果用户在美国，优先建议联系 988；如果不在美国，建议联系当地紧急支持或危机热线。\n"
            f"- 美国危机支持：{us_resource.get('label', '988')}，电话/短信 {us_resource.get('phone', '988')}，链接 {us_resource.get('url', '')}\n"
            f"- 如有立即危险，建议联系 {emergency.get('label', 'local emergency services')}（{emergency.get('phone', '')}）。\n"
            "- 不继续普通 reflective coaching，不做长篇分析，不提供任何自伤、伤人或隐瞒求助的建议。"
        )
        return SupportPlan(
            risk_level=risk_level,
            response_mode=response_mode,
            risk_matches=risk_matches,
            context=context,
        )

    module, confidence, matched_terms = select_support_module(query, memory_context, recent_messages)
    if not module:
        return SupportPlan(
            risk_level="low",
            response_mode="reflective_support",
            context=(
                "【心理支持通用规则】\n"
                "- 先承接用户当前体验，再尝试命名一个最核心的模式。\n"
                "- 一次只推进一个小问题，不要讲成泛心理学文章。\n"
                "- 不做诊断，不夸大，不承诺替代专业治疗。"
            ),
        )

    context = (
        "【心理支持模块】\n"
        f"- 当前模块：{module['name']}（{module['module_id']}）\n"
        f"- 本轮目标：{'; '.join(module.get('goals', [])[:2])}\n"
        f"- 输出要求：{'; '.join(module.get('response_requirements', [])[:2])}\n"
        f"- 必须做到：{'; '.join(module.get('must_do', [])[:2])}\n"
        f"- 可以考虑：{'; '.join(module.get('nice_to_do', [])[:2])}\n"
        f"- 候选问题：{'; '.join(module.get('assessment_questions', [])[:2])}\n"
        f"- 候选解释：{'; '.join(module.get('psychoeducation_points', [])[:2])}\n"
        f"- 候选微动作：{'; '.join(module.get('micro_interventions', [])[:2])}\n"
        f"- 禁止做法：{'; '.join(module.get('do_not', [])[:3])}\n"
        f"- 可继续追问：{'; '.join(module.get('followup_questions', [])[:1])}\n"
        f"- 表达自由：{module.get('style_freedom_note', '让这些规则决定方向，不要机械照抄成固定话术。')}\n"
        f"- 证据锚点：\n{_format_sources(module.get('source_refs', []))}"
    )
    return SupportPlan(
        risk_level="low",
        response_mode="module_guided_support",
        selected_module_id=module.get("module_id"),
        selected_module_name=module.get("name"),
        confidence=confidence,
        matched_terms=matched_terms,
        context=context,
    )
