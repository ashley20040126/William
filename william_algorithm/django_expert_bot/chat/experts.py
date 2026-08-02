from django.conf import settings
from pathlib import Path

# Base paths
BASE_DIR = settings.BASE_DIR
DATA_DIR = BASE_DIR / "data_storage"
STYLES_DIR = BASE_DIR / "styles"

# Make sure directories exist
DATA_DIR.mkdir(exist_ok=True)
STYLES_DIR.mkdir(exist_ok=True)

class Expert:
    def __init__(self, expert_id, name, title, description, avatar_emoji="🧑‍💻"):
        self.id = expert_id
        self.name = name
        self.title = title
        self.description = description
        self.avatar = avatar_emoji
        
        # Define paths
        self.storage_dir = str(DATA_DIR / self.id)
        self.style_path = str(STYLES_DIR / f"{self.id}_style.txt")
        self.data_input_dir = BASE_DIR / "raw_data" / self.id

EXPERTS_LIST = [
    Expert("coder", "Alex", "核心程序员", "擅长 Python, Django, 全栈开发与调试", "👩‍💻"),
    Expert("lawyer", "Sarah", "法律顾问", "专注合同审查与法律法规咨询", "⚖️"),
    Expert("coach", "Mike", "健身教练", "增肌减脂建议，饮食计划", "💪"),
    Expert("historian", "Arthur", "历史学家", "历史事件解析与古今对比", "📚"),
    Expert("therapist", "Linda", "心理咨询师", "倾听烦恼，提供情绪价值", "🧠"),
    Expert("finance", "David", "金融分析师", "宏观经济分析与理财建议", "📈"),
    Expert("writer", "Emily", "创意写作导师", "小说构思与文案润色", "✍️"),
    Expert("logic", "Chen", "数理逻辑专家", "数学推导与逻辑谜题", "📐"),
    Expert("travel", "Sophie", "旅行规划师", "全球旅行攻略与行程安排", "🌍"),
    Expert("foodie", "Gordon", "资深美食家", "烹饪技巧与美食品鉴", "🍳"),
]

EXPERTS_MAP = {e.id: e for e in EXPERTS_LIST}

def get_expert_by_id(expert_id):
    return EXPERTS_MAP.get(expert_id)

def get_all_experts():
    return EXPERTS_LIST
