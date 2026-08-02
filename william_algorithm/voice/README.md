# 数字化生物标志物音频分析流水线 (Digital Biomarker Audio Pipeline)

本项目是一款针对**心理健康监测**设计的隐私保护型音频分析系统。基于 **Pattern First, Content Optional (模式优先，内容可选)** 的核心哲学，通过三层解耦架构，从原始音频中提取非语义特征，并在必要时结合语义增强，实现对用户行为模式和心理状态的被动感知与深度归因。

---

## 🏗 系统架构图 (v1.2)

```text
[原始音频流] 
    |
    v
+-------------------------------------------------------------+
| Layer 1: 信号感知层 (秒级微观分析)                           |
| - VAD 语音检测 | OpenSMILE 物理声学特征 (Energy/Pitch)       |
+-------------------------------------------------------------+
    | (JSONL 流)
    v
+-------------------------------------------------------------+
| Layer 2: 事件生成层 (片段聚类与增强)                         |
| - 状态机转换 | 碎片迟滞合并 (Hysteresis)                     |
| - 情绪模型 (Wav2Vec2) 作为置信度调节器 (Confidence Modifier)|
| - [ASR] distil-large-v3 (自动中英识别)                       |
+-------------------------------------------------------------+
    | (事件序列) -> 物理落盘边界 (Streaming vs Batch)
    v
+-------------------------------------------------------------+
| Layer 3 & 4: 模式比对与画像层 (宏观报告)                     |
| - 动态基线对比 (Population / Rolling Baseline)               |
| - 严格证据边界约束的 LLM 心理侧写 (Evidence Boundary)        |
+-------------------------------------------------------------+
```

---

## 📂 核心技术流程详解

### 1. Layer 1: 信号感知层 (Perception)
该层为系统的“数字传感器”，运行频率为 1Hz，**仅提取客观物理特征，不做任何主观解释**。
*   **VAD**: 提取 `speech_ratio`，判断是否有语音活动。
*   **Acoustic Features**: 提取 `RMS energy` (能量), `Pitch/F0` (音高) 及其方差。
*   **Signal Quality**: 评估信噪比与爆音，对劣质信号打标隔离。

### 2. Layer 2: 事件生成层 (Events)
该层将秒级特征还原为高维度的行为事件（如 `SOCIAL_INTERACTION`, `HIGH_AROUSAL_BURST`）。
*   **物理特征驱动**: 事件的核心判定依赖于语音时长、能量波动等客观规律，而非单一的 AI 黑盒模型。
*   **Emotion 置信度调节**: Wav2Vec2 情感预测仅作为“插件”，当其输出（如 `ang`）与物理高唤醒特征匹配时，增加事件判定置信度；模型失效时亦不影响主干运行。
*   **ASR 语义辅助**: 采用 **`distil-large-v3`** 模型（7.5亿参数），支持中英文自动识别与转录。

### 3. Layer 3 & 4: 模式比对与画像层 (Patterns & Interpretation)
该层是系统的“大脑”，负责生成具备医学和心理学价值的综合报告。
*   **基线对比 (Baseline Deviation)**: 摒弃静态阈值，引入常模对比。例如判断今日社交时长是 `higher_than_usual` 还是 `lower_than_usual`。
*   **严控边界的 LLM 侧写 (Evidence Boundary)**:
    *   **无 ASR 文本时**：LLM 仅允许描述客观行为模式（如“用户表现出高唤醒的孤立状态”）。
    *   **有 ASR 文本时**：结合语义进行深度归因，结构化提取具体的事实和压力触发点。

---

## 📊 实验与验证

本项目包含两套验证体系：
- **`test_bench/`**: 受控环境下的基础功能验证（社交互动、极端情感、呼吸练习）。
- **`lab_bench/`**: 真实场景下的压力测试（含 YouTube 采样、多语言混合、自然环境噪音）。

详细的算法效能评估请参阅各目录下的 `report.txt`。

---

## 🛠 开发与部署

### 环境安装
使用 `uv` 进行依赖管理：
```bash
uv sync
```

### 核心配置 (`audio_pipeline/config.py`)
- **`ASR_MODEL_SIZE`**: 推荐使用 `"distil-large-v3"` 以平衡速度与准确度。
- **自动语言检测**: 模型会自动识别首段音频语言，无需手动指定。

### 运行分析
```bash
# 全量运行（含 ASR 语义增强，自动识别中英文）
uv run python run_pipeline.py <音频>

# 纯物理模式运行（测试 Evidence Boundary 约束）
uv run python run_pipeline.py <音频> --no-asr
```

### 运行 Voice FastAPI 服务

William 主产品现在会把这里当作语音转写服务来调用。先复制环境变量：

```bash
cp .env.example .env
uv sync
```

然后启动：

```bash
.venv/bin/python3 -m uvicorn voice_service:app --host 127.0.0.1 --port 8020
```

可用接口：

- `GET /health`
- `POST /transcribe`
- `POST /analyze`

`POST /transcribe` 接收 JSON：

```json
{
  "audio_base64": "<base64-audio>",
  "filename": "voice.webm",
  "mime_type": "audio/webm"
}
```

返回：

```json
{
  "text": "转写结果",
  "language": null,
  "duration_ms": 3210
}
```

`POST /analyze` 也接收同样的 JSON，但除了 transcript 之外还会返回一组轻量 voice-derived 指标：

```json
{
  "text": "转写结果",
  "language": null,
  "duration_ms": 3210,
  "voice_stress": 6.4,
  "dominant_emotion": "neutral",
  "speech_pace_tpm": 182.5,
  "emotional_stability": 0.58,
  "vocal_vitality": 0.41,
  "flags": ["HIGH_COGNITIVE_PRESSURE_ALERT"]
}
```

在 `Development/backend` 中：

- `/api/voice/transcribe` 会调用这里做语音转文字
- `/api/voice/transcribe-chunk` 会对浏览器 fallback 录音做流式分段预转写
- `/api/voice/ambient-listening-audio` 会调用这里做后台监听音频片段分析，并把结果聚合到后端 `day_profiles`
- `/api/voice/tts` 不走这里；它会直接调用 OpenAI TTS，当前默认中文音色为 `verse`，英文音色为 `sage`
- `/api/voice/call-turn-text` 会接收最终 transcript，再复用同一条聊天与记忆链路
- `/api/voice/call-turn` 会先调用这里转写，再复用同一条聊天与记忆链路
