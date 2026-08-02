# AI 专家顾问团 (AI Expert Panel)

## 1. 项目概述
本项目是一个基于 Django 的智能问答 Web 应用。系统内置了 **10 位不同领域的 AI 专家**（数字分身），用户可以自由选择特定的专家进行咨询，也可以直接提问，由系统自动分析问题意图并路由给最合适的专家进行回答。

### 核心价值
*   **专业性**：通过预设的 System Prompts（甚至挂载专属 RAG 知识库），让每个 AI 角色专注于特定领域，提供比通用模型更精准、风格更鲜明的回答。
*   **灵活性**：既支持用户的“主动选择”，也支持系统的“智能分发”，降低用户的使用门槛。
*   **可扩展性**：基于 Django 架构，未来可轻松通过接入 LightRAG 等技术增强专家的记忆与知识深度。

---

## 2. 功能详细设计

### 2.1 前端功能
1.  **专家选择大厅 (Expert Lobby)**
    *   展示 10 张专家卡片（头像 + 名字 + 领域介绍）。
    *   并在显眼位置提供“智能问答（自动匹配）”按钮。
    *   用户点击卡片进入对应专家的专属聊天窗口。
2.  **对话界面 (Chat Interface)**
    *   标准的消息流界面（用户气泡右侧，专家气泡左侧）。
    *   **动态身份标识**：如果是“智能问答”模式，专家回复时需显示当前是哪位专家在服务（例如：“[正在由 法律顾问 回答...]”）。

### 2.2 后端功能 (Django)
1.  **模型服务层 (LLM Service)**
    *   集成 OpenAI / 兼容 OpenAI 格式的大模型 API。
    *   维护一个 `Experts Configuration`（专家配置文件），包含每位专家的人设（System Prompt）。
2.  **路由与分发 (Router & Dispatcher)**
    *   **指定模式**：直接调用选定专家的 System Prompt 进行对话。
    *   **自动模式**：接收用户问题 -> 调用轻量级模型判定领域 -> 返回 Expert ID -> 再次调用对应 Expert 进行回答。
3.  **专家阵容 (The 10 Experts)**
    1.  **👩‍💻 核心程序员 (Python/Fullstack)**: 擅长代码审查、架构设计、Bug 修复。
    2.  **⚖️ 法律顾问**: 擅长合同分析、法律风险评估、法规解释。
    3.  **💪 健身教练**: 擅长制定训练计划、营养饮食建议。
    4.  **📚 历史学家**: 擅长历史事件解析、古今对比。
    5.  **🧠 心理咨询师**: 擅长倾听、情绪价值提供、心理疏导。
    6.  **📈 金融分析师**: 擅长宏观经济分析、投资理财知识。
    7.  **✍️ 创意写作导师**: 擅长小说大纲优化、修辞润色。
    8.  **📐 数理逻辑专家**: 擅长数学推导、逻辑谜题。
    9.  **🌍 旅行规划师**: 擅长行程安排、景点推荐、交通攻略。
    10. **🍳 资深美食家**: 擅长烹饪技巧、食材挑选、美食品鉴。

---

## 3. 技术架构蓝图

```mermaid
graph TD
    User[用户] --> Frontend[前端页面 Django Templates]
    Frontend -->|POST 提问| Views[Django Views]
    
    subgraph "AI Service Core"
        Views -->|Mode=Auto| Router[路由 Agent (GPT-4o-mini)]
        Views -->|Mode=Specific| Executor[执行 Agent (GPT-4o)]
        Router -->|返回 Expert ID| Executor
        
        Executor -->|加载 Prompt| ExpertConfig[专家配置库]
        ExpertConfig -->|Expert 1| P1[程序员 Prompt]
        ExpertConfig -->|Expert 2| P2[律师 Prompt]
        ExpertConfig -->|...| PX[其他专家]
    end
    
    Executor -->|流式/非流式响应| Views
    Views -->|JSON/HTML| Frontend
```

### 数据库设计 (Simple)
*   不需要复杂的 User 系统（Demo 阶段可由 Session 管理）。
*   **ChatSession**: `id`, `session_key`, `expert_id` (null if auto), `created_at`
*   **ChatMessage**: `session`, `role` (user/assistant), `content`, `expert_name` (记录实际回答的一方), `created_at`

---

## 4. 后续扩展方向 (Advanced)
*   **接入 LightRAG**：为每位专家挂载独立的 `lightrag_storage`，例如“法律顾问”挂载民法典知识库。
*   **风格化重写**：利用 `style_rewrite.py` 提取真实专家的说话风格，让“历史学家”说话文绉绉，让“健身教练”说话充满激情。

