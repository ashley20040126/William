import json
import re
from functools import lru_cache
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
MENTAL_KB_ROOT = BASE_DIR / "mental_kb"
SAFETY_POLICY_PATH = MENTAL_KB_ROOT / "safety" / "risk_policy.json"
MODULES_DIR = MENTAL_KB_ROOT / "modules"


def read_json(file_path: Path):
    return json.loads(file_path.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_safety_policy():
    return read_json(SAFETY_POLICY_PATH)


@lru_cache(maxsize=1)
def load_modules():
    return sorted(
        [read_json(file_path) for file_path in MODULES_DIR.glob("*.json")],
        key=lambda item: item.get("module_id", ""),
    )


def normalize_text(text: str | None) -> str:
    return re.sub(r"\s+", " ", str(text or "").lower()).strip()


def collect_text(query: str, memory_context: str = "", recent_messages: list[dict] | None = None) -> str:
    messages = recent_messages or []
    parts = [query, memory_context, *[message.get("content", "") for message in messages[-6:]]]
    return normalize_text("\n".join([part for part in parts if part]))


def collect_secondary_context(memory_context: str = "", recent_messages: list[dict] | None = None) -> str:
    messages = recent_messages or []
    parts = [memory_context, *[message.get("content", "") for message in messages[-6:]]]
    return normalize_text("\n".join([part for part in parts if part]))


def detect_risk_signals(query: str, memory_context: str = "", recent_messages: list[dict] | None = None):
    text = collect_text(query, memory_context, recent_messages)
    policy = load_safety_policy()

    for level in ["imminent", "high", "moderate"]:
        level_policy = (policy.get("levels") or {}).get(level) or {}
        matches = [
            keyword
            for keyword in level_policy.get("keywords", [])
            if normalize_text(keyword) and normalize_text(keyword) in text
        ]
        if matches:
            return {
                "riskLevel": level,
                "responseMode": level_policy.get("response_mode", "reflective_support"),
                "matches": matches,
            }

    return {
        "riskLevel": "low",
        "responseMode": "reflective_support",
        "matches": [],
    }


def score_module(module: dict, text: str):
    score = 0.0
    matches = []

    for keyword in module.get("keywords", []):
        normalized = normalize_text(keyword)
        if normalized and normalized in text:
            score += 1 if len(normalized) <= 4 else 1.4
            matches.append(keyword)

    module_id = module.get("module_id")
    if module_id == "difficult_conversation":
        if any(token in text for token in ["开口", "怎么说", "说出口", "谈", "沟通", "conversation"]):
            score += 2
        if any(token in text for token in ["妈妈", "爸爸", "父母", "伴侣", "老板", "男朋友", "女朋友", "partner", "boss"]):
            score += 1.5
    elif module_id == "boundaries_relationship":
        if any(token in text for token in ["边界", "拒绝", "讨好", "委屈", "被消耗", "关系", "resentful", "people-pleasing", "set boundaries", "controlled"]):
            score += 2
    elif module_id == "sleep_disruption":
        if any(token in text for token in ["失眠", "睡不着", "早醒", "半夜醒", "insomnia", "很早就醒", "can't fall asleep", "mind keeps racing", "醒来", "一躺下"]):
            score += 2
        if all(token in text for token in ["晚上", "累", "躺下"]):
            score += 1.6
    elif module_id == "rumination":
        if any(token in text for token in ["反复想", "停不下来", "内耗", "想不通", "overthinking"]):
            score += 2
    elif module_id == "anxiety_escalation":
        if any(token in text for token in ["焦虑", "紧张", "panic", "心慌", "担心", "something bad is about to happen", "胸口发紧", "chest feels tight"]):
            score += 2
    elif module_id == "low_mood_inertia":
        if any(token in text for token in ["低落", "没力气", "提不起劲", "不想动", "无意义", "down", "动不起来", "pointless"]):
            score += 2

    return {
        "score": score,
        "matches": list(dict.fromkeys(matches)),
    }


def apply_intent_bias(module_id: str, retrieval_intent: str = "general_support", primary_score: float = 0, secondary_score: float = 0):
    score = primary_score * 1.35 + min(secondary_score, 1.5)

    if retrieval_intent == "sleep_recovery":
        if module_id == "sleep_disruption":
            score += 1.8
        if module_id == "rumination":
            score -= 0.6

    if retrieval_intent == "relationship_conversation":
        if module_id == "difficult_conversation":
            score += 1.2
        if module_id == "boundaries_relationship":
            score += 0.8

    if retrieval_intent == "active_problem_solving":
        if module_id == "difficult_conversation":
            score += 0.6
        if module_id == "low_mood_inertia":
            score -= 0.3

    return score


def requires_primary_support_signal(retrieval_intent: str = "general_support"):
    return retrieval_intent in {"file_or_url_followup", "memory_audit", "schedule_logistics"}


def should_skip_low_risk_support_context(retrieval_intent: str = "general_support", query: str = ""):
    if retrieval_intent not in {"file_or_url_followup", "memory_audit", "schedule_logistics"}:
        return False

    return re.search(r"(焦虑|难过|低落|委屈|崩溃|压力|害怕|撑不住|情绪|失眠|睡不着|紧张)", normalize_text(query)) is None


def should_include_generic_support_rule(retrieval_intent: str = "general_support"):
    return retrieval_intent not in {"file_or_url_followup", "memory_audit", "schedule_logistics"}


def looks_like_factual_knowledge_request(query: str = ""):
    normalized = normalize_text(query)
    if not normalized:
        return False

    strong = re.compile(r"(论文|研究|文献|paper|study|摘要|总结|资料|报告|定义|解释一下|科普一下)")
    weak = re.compile(r"(什么意思|是什么)")
    self_distress = re.compile(
        r"((我最近|我现在|我这阵子|我自己|自己现在|今天|有点|说不上来|不知道)|((?:我(?:觉得|感觉|很|有点|太|一直|总是|最近|现在|这阵子|也)?)[^。；，,\n]{0,12}(烦|乱|慌|累|难受|焦虑|难过|低落|委屈|崩溃|压力|害怕|撑不住|情绪|失眠|睡不着|紧张))|((感觉|状态).*(焦虑|难过|低落|委屈|崩溃|压力|害怕|撑不住|情绪|失眠|睡不着|紧张)))"
    )
    if strong.search(normalized):
        return True
    return bool(weak.search(normalized) and not self_distress.search(normalized))


def select_support_module(query: str, memory_context: str = "", recent_messages: list[dict] | None = None, retrieval_intent: str = "general_support"):
    primary_text = normalize_text(query)
    secondary_text = collect_secondary_context(memory_context, recent_messages)
    best_module = None
    best_score = 0.0
    best_matches = []
    best_primary_score = 0.0
    best_secondary_score = 0.0

    for module in load_modules():
        primary = score_module(module, primary_text)
        secondary = score_module(module, secondary_text)
        score = apply_intent_bias(
            module.get("module_id", ""),
            retrieval_intent,
            primary["score"],
            secondary["score"],
        )
        if score > best_score:
            best_module = module
            best_score = score
            best_matches = list(dict.fromkeys([*primary["matches"], *secondary["matches"]]))
            best_primary_score = primary["score"]
            best_secondary_score = secondary["score"]

    if not best_module:
        return None

    min_primary_score = 1.6 if requires_primary_support_signal(retrieval_intent) else 1.2
    min_combined_score = 2.4 if retrieval_intent == "general_support" else 2.8
    if best_primary_score < min_primary_score or best_score < min_combined_score:
        return None

    return {
        "module": best_module,
        "confidence": min(0.98, 0.45 + best_score / 10),
        "matches": best_matches,
        "primaryScore": round(best_primary_score, 2),
        "secondaryScore": round(best_secondary_score, 2),
    }


def build_support_guidance(
    query: str,
    memory_context: str = "",
    recent_messages: list[dict] | None = None,
    retrieval_intent: str = "general_support",
    user_stance: str = "neutral",
):
    risk = detect_risk_signals(query, memory_context, recent_messages)
    policy = load_safety_policy()

    if risk["riskLevel"] != "low":
        us_resource = (policy.get("resources") or {}).get("us_crisis_line", {})
        emergency = (policy.get("resources") or {}).get("emergency", {})
        return {
            "riskLevel": risk["riskLevel"],
            "responseMode": risk["responseMode"],
            "selectedModuleId": None,
            "selectedModuleName": None,
            "confidence": 0,
            "matchedTerms": [],
            "riskMatches": risk["matches"],
            "context": "\n".join(
                [
                    "【心理支持安全规则】",
                    f"- 当前风险等级：{risk['riskLevel']}",
                    f"- 命中的风险信号：{', '.join(risk['matches'])}",
                    "- 先简短承接情绪与痛苦，再明确建议立刻联系真人支持。",
                    "- 如果用户在美国，优先建议联系 988；如果不在美国，建议联系当地紧急支持或危机热线。",
                    f"- 美国危机支持：{us_resource.get('label', '988')}，电话/短信 {us_resource.get('phone', '988')}，链接 {us_resource.get('url', '')}",
                    f"- 如有立即危险，建议联系 {emergency.get('label', 'local emergency services')}（{emergency.get('phone', '')}）。",
                    "- 不继续普通 reflective coaching，不做长篇分析，不提供任何自伤、伤人或隐瞒求助的建议。",
                ]
            ),
        }

    if user_stance == "asking_fact" or looks_like_factual_knowledge_request(query):
        return {
            "riskLevel": "low",
            "responseMode": "knowledge_request",
            "selectedModuleId": None,
            "selectedModuleName": None,
            "confidence": 0,
            "matchedTerms": [],
            "riskMatches": [],
            "context": "",
        }

    if should_skip_low_risk_support_context(retrieval_intent, query):
        return {
            "riskLevel": "low",
            "responseMode": "context_skipped",
            "selectedModuleId": None,
            "selectedModuleName": None,
            "confidence": 0,
            "matchedTerms": [],
            "riskMatches": [],
            "context": "",
        }

    selected = select_support_module(query, memory_context, recent_messages, retrieval_intent)
    if not selected:
        return {
            "riskLevel": "low",
            "responseMode": "reflective_support",
            "selectedModuleId": None,
            "selectedModuleName": None,
            "confidence": 0,
            "matchedTerms": [],
            "riskMatches": [],
            "context": "\n".join(
                [
                    "【心理支持通用规则】",
                    "- 先承接用户当前体验，再尝试命名一个最核心的模式。",
                    "- 一次只推进一个小问题，不要讲成泛心理学文章。",
                    "- 不做诊断，不夸大，不承诺替代专业治疗。",
                ]
            )
            if should_include_generic_support_rule(retrieval_intent)
            else "",
        }

    module = selected["module"]
    return {
        "riskLevel": "low",
        "responseMode": "module_guided_support",
        "selectedModuleId": module.get("module_id"),
        "selectedModuleName": module.get("name"),
        "confidence": round(selected["confidence"], 3),
        "matchedTerms": selected["matches"],
        "riskMatches": [],
        "context": "\n".join(
            [
                "【心理支持模块】",
                f"- 当前模块：{module.get('name')}（{module.get('module_id')}）",
                f"- 本轮目标：{'; '.join((module.get('goals') or [])[:1])}",
                f"- 输出要求：{'; '.join((module.get('response_requirements') or [])[:1])}",
                f"- 必须做到：{'; '.join((module.get('must_do') or [])[:2])}",
                f"- 优先动作：{'; '.join((module.get('micro_interventions') or [])[:2])}",
                f"- 禁止做法：{'; '.join((module.get('do_not') or [])[:3])}",
                f"- 表达自由：{module.get('style_freedom_note') or '让这些规则决定方向，不要机械照抄成固定话术。'}",
            ]
        ),
    }
