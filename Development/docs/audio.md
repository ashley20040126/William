# William 音频算法逻辑

## 0. 一眼看懂版

现在这条音频算法链路，不是“一个大模型端到端算出 stress”。

它更像 3 层拼起来：

```text
原始音频
  -> 先转成统一格式
  -> 再分别提文本、声学、情绪、VAD 这些底层信号
  -> 最后用规则把这些底层信号拼成产品指标
```

所以当前结果里：

- `text`：主要来自 Whisper
- `dominant_emotion`：主要来自 emotion model
- `speech_pace_tpm / vitality / stability`：主要来自聚合规则
- `voice_stress`：完全是启发式综合分，不是模型直接预测

如果只想先抓住一句：

`现在的 William 音频算法，是“模型识别底层信号 + 规则合成产品指标”的混合系统。`

---

## 1. 这份文档到底讲什么

这份文档主要讲：

`Start Listening 之后，音频是如何被算法处理，最后变成 transcript、stress、emotion、stability 这些结果的。`

它**不是**主要讲前后端接口怎么接。

这份文档主要对应当前代码：

- [voice_service.py](../../william_algorithm/voice/voice_service.py)
- [features.py](../../william_algorithm/voice/audio_pipeline/layer1/features.py)
- [events.py](../../william_algorithm/voice/audio_pipeline/layer2/events.py)
- [patterns.py](../../william_algorithm/voice/audio_pipeline/layer3/patterns.py)

---

## 2. 整体算法图

```text
原始音频
  ↓
ffmpeg 解码成 16kHz 单声道 float32
  ↓
WhisperTranscriber 做整段转写
  ↓
FeatureExtractor 按 1 秒切窗
  ↓
每 1 秒做：
  - RMS / peak / clipping / snr proxy
  - VAD speech_ratio
  - 3 秒上下文情绪识别
  - 3 秒上下文声学特征（F0 / jitter / shimmer / loudness）
  ↓
StateClassifier 把每秒打成：
  - SPEECH
  - SILENCE
  - LOW_QUALITY
  - UNKNOWN
  ↓
SegmentMerger 把相邻同类秒合并成 segment
  ↓
EventGenerator 把 segment 转成 event：
  - SOCIAL_INTERACTION
  - HIGH_AROUSAL_BURST
  - PROLONGED_SILENCE
  - LOW_QUALITY_BLOCK
  ...
  ↓
PatternAnalyzer 聚合得到：
  - speech_pace_tpm
  - vocal_vitality
  - emotional_stability
  - dominant_vibe
  - clinical_flags
  ↓
derive_voice_stress() 再把这些指标压成 1~10 的 stress 分数
```

---

## 3. 真正的算法入口在哪里

核心入口在：

- [voice_service.py](../../william_algorithm/voice/voice_service.py)

真正被后端 `/api/voice/ambient-listening-audio` 调用的，是这里的：

- `analyze()`

它内部现在有两条分支：

1. `ASR on`
   - `WhisperTranscriber.transcribe_slice(...)`
   - `run_voice_analysis(...)`
2. `ASR off`
   - 跳过转写
   - 只跑 `run_voice_analysis(...)`

所以环境监听现在不是永远都转文字，而是：

- **允许 ASR**：返回文本结果 + 声学结果
- **不允许 ASR**：只返回声学结果，不保存监听文本

---

## 4. 第 1 步：先把任何音频都转成统一格式

函数：

- `decode_audio_file()`

做法很直接：

- 用 `ffmpeg`
- 输入原始文件
- 输出 `16kHz / mono / float32`

最后算法真正吃到的是：

- `numpy float32 array`
- `sample_rate = 16000`

这一步的意义很大：

- 不管你传的是 `webm / wav / mp3 / m4a`
- 后面的模型都只面对一种统一格式

所以可以把这一步理解成：

`先把杂乱输入变成一个标准音频张量。`

---

## 5. 第 2 步：先做整段 ASR 转写

文件：

- [asr.py](../../william_algorithm/voice/audio_pipeline/layer2/asr.py)

模型：

- `faster-whisper`

类：

- `WhisperTranscriber`

当前做法：

- 模型大小来自环境变量，默认在 service 层是 `base`
- `transcribe_slice()` 直接对整段音频做转写
- `beam_size = 5`
- 语言不锁死，靠模型自动检测

但要注意：

- 这一步现在只在 `ambient listening` 允许 ASR 时才会执行
- 语音通话和普通语音输入仍然固定走 ASR

这一层输出很简单：

- 一段完整 transcript

要注意：

- 这里**没有**逐句对齐
- 也没有 speaker diarization
- 更没有“边转边算 stress”

所以当前版本的 ASR 是：

`整段音频 -> 一次性文本结果`

而不是实时流式 ASR 状态机。

---

## 6. 第 3 步：逐秒做基础特征提取

文件：

- [features.py](../../william_algorithm/voice/audio_pipeline/layer1/features.py)

类：

- `FeatureExtractor`

这里是整个音频算法最关键的一层。

它不是整段算一次，而是：

- 以 **1 秒** 为步长滑动
- 每次取：
  - 一个 **1 秒 basic window**
  - 一个 **3 秒 context window**

配置来自：

- [config.py](../../william_algorithm/voice/audio_pipeline/config.py)

关键参数：

- `WINDOW_SIZE_SEC = 1.0`
- `CONTEXT_WINDOW_SIZE = 3.0`

所以可以把它理解成：

- **1 秒窗口**负责回答：这一秒发生了什么
- **3 秒窗口**负责回答：这一秒放到上下文里听起来像什么

---

## 7. 每 1 秒具体提了哪些特征

每个 1 秒窗口都会先算一组基础信号特征：

- `rms`
- `peak`
- `clipping_ratio`
- `snr_proxy`

### 这些特征是什么意思

- `rms`
  - 粗略代表这秒的平均能量
- `peak`
  - 峰值幅度
- `clipping_ratio`
  - 有多少采样点接近爆音
- `snr_proxy`
  - 不是严格 SNR，而是用 `rms / silence_threshold` 做的简化噪声指标

这些特征主要不是直接给用户看的，而是用于：

- 判断有没有声音
- 判断录音质量是否差
- 决定后面要不要跑重模型

---

## 8. VAD 是怎么做的

文件：

- [vad.py](../../william_algorithm/voice/audio_pipeline/layer1/vad.py)

类：

- `VAD`

现在是两层策略：

### 优先：WebRTC VAD

如果环境里装了 `webrtcvad`：

- 把 float32 音频转成 int16 PCM
- 按 **30ms** 切 frame
- 每帧调用 `vad.is_speech(...)`
- 最后算：

`speech_ratio = 语音帧数 / 总帧数`

### 兜底：能量阈值

如果没有 `webrtcvad`：

- 直接看 RMS
- 大于 `VAD_ENERGY_THRESHOLD = 0.02` 就当有语音

另外还有一个更前置的硬规则：

- 如果 `rms < RMS_SILENCE_THRESHOLD = 0.01`
- 直接视为 `speech_ratio = 0`

所以这层不是“复杂大模型”，而是很典型的：

`确定性语音活动检测 + fallback。`

---

## 9. 情绪和声学特征什么时候才会跑

不是每个窗口都跑重分析。

`FeatureExtractor` 里有一个很关键的 gate：

- `speech_ratio > 0.1`
  或
- `rms > silence_threshold * 2`

满足才算 `is_active`

并且：

- `quality_flag == "OK"`

只有这样才会继续跑：

- `acoustic.extract_acoustic_features(...)`
- `emotion.predict_emotion(...)`

这一步的思路很务实：

`先用便宜规则挡掉沉默和脏数据，再把真正的模型调用留给像是“活跃语音”的片段。`

---

## 10. 情绪识别到底怎么做

文件：

- [emotion.py](../../william_algorithm/voice/audio_pipeline/layer1/emotion.py)

模型：

- `superb/wav2vec2-base-superb-er`

它的逻辑是：

1. 懒加载 Hugging Face 模型
2. 对 3 秒上下文音频做特征提取
3. 走 `Wav2Vec2ForSequenceClassification`
4. softmax 出所有情绪分数
5. 取 top label

最终输出：

- `top_label`
- `confidence`
- `distribution`

也就是说，当前 emotion 不是自己手写规则得来的，而是：

`预训练语音情绪分类模型输出的类别。`

---

## 11. 声学特征是怎么做的

文件：

- [acoustic.py](../../william_algorithm/voice/audio_pipeline/layer1/acoustic.py)

工具：

- `OpenSMILE`
- 特征集：`eGeMAPSv02`

当前提的核心值有：

- `F0semitoneFrom27.5Hz_sma3nz` -> `f0_semitone`
- `jitterLocal_sma3nz` -> `jitter`
- `shimmerLocaldB_sma3nz` -> `shimmer`
- `Loudness_sma3` -> `loudness_smile`

这层做法不是拿逐帧结果直接输出，而是：

- 先拿一堆低层描述子
- 再对当前窗口取均值

所以它更像：

`把这一小段说话的“声音质地”压成几个稳定数值。`

---

## 12. 第 4 步：把每秒分类成状态

文件：

- [state_classifier.py](../../william_algorithm/voice/audio_pipeline/layer2/state_classifier.py)

输出状态只有 4 个：

- `SPEECH`
- `SILENCE`
- `LOW_QUALITY`
- `UNKNOWN`

规则很直接：

### 优先级 1：坏质量

只要 `quality_flag != OK`

-> `LOW_QUALITY`

### 优先级 2：明确语音

如果：

- `speech_ratio >= 0.3`

-> `SPEECH`

### 优先级 3：明确沉默

如果：

- `speech_ratio <= 0.05`
- 并且 `rms <= 0.01`

-> `SILENCE`

### 其他情况

-> `UNKNOWN`

所以这一层本质上是：

`规则分类器，不是模型分类器。`

---

## 13. 第 5 步：把相邻秒合并成 segment

文件：

- [segment_merge.py](../../william_algorithm/voice/audio_pipeline/layer2/segment_merge.py)

做法很朴素：

- 如果当前秒和上一个秒状态一样
  - 合并
- 否则
  - 开新 segment

当前没有复杂 hysteresis，也没有真正的 gap healing。

这里要特别注意一个现实点：

- [config.py](../../william_algorithm/voice/audio_pipeline/config.py) 里虽然有 `MERGE_GAP_TOLERANCE_SEC = 1.0`
- 但当前 `SegmentMerger` 实现并没有真的把这个容忍窗口用起来

所以它现在更接近：

`状态一变就切段`

这也是为什么当前情绪稳定性和事件边界会比较抖。

所以你可以把它理解成：

`先得到一串逐秒标签，再把连续同类秒压成更长的段。`

segment 里会累计：

- `start_ts_ms`
- `end_ts_ms`
- `duration_s`
- `features_accumulator`
- `emotion_counts`

其中 `emotion_counts` 很关键，因为后面 dominant emotion 就靠它统计。

---

## 14. 第 6 步：把 segment 变成更高层事件

文件：

- [events.py](../../william_algorithm/voice/audio_pipeline/layer2/events.py)

这一步开始不再只说“有语音没语音”，而是开始用业务语言命名事件。

例如：

- `SOCIAL_INTERACTION`
- `HIGH_AROUSAL_BURST`
- `SHORT_SPEECH`
- `PROLONGED_SILENCE`
- `LOW_QUALITY_BLOCK`

### 这一步怎么判

以 `SPEECH` 为例：

- 先看 duration
- 再看情绪
- 再看 RMS 能量

如果：

- `duration >= 5s`

并且：

- `rms_mean > 0.1`

就可能升成：

- `HIGH_AROUSAL_BURST`

否则更可能是：

- `SOCIAL_INTERACTION`

这层的重点是：

`原始声学片段被翻译成更适合后面画像分析的事件语义。`

但要明确一点：当前 `EventGenerator` 还比较粗。

它更像：

- duration 规则
- RMS 阈值
- dominant emotion 修饰

的组合器，而不是复杂行为理解器。

所以：

- `SOCIAL_INTERACTION`
- `HIGH_AROUSAL_BURST`

这些标签现在都应该理解成：

`业务上可用的近似事件`

不是精确的人类行为真相。

---

## 15. 第 7 步：算 William 真正关心的几个“生物标志”

文件：

- [patterns.py](../../william_algorithm/voice/audio_pipeline/layer3/patterns.py)

类：

- `PatternAnalyzer`

这里输出的是最核心的几个指标：

- `speech_pace_tpm`
- `vocal_vitality`
- `emotional_stability`
- `dominant_vibe`
- `clinical_flags`

下面是它们的算法。

---

## 16. `speech_pace_tpm` 怎么算

先统计：

- `verified_speech_dur`
  - 只有同时满足“事件像 speech”且 ASR 确实识别到 transcript”的时间，才算进去
- `total_tokens`
  - 英文：按单词数
  - 中文：按 CJK 字数

然后：

`speech_pace_tpm = total_tokens / (verified_speech_dur / 60)`

也就是：

`每分钟说出了多少 token`

这个指标的解释很直观：

- 很高：可能急、压迫、焦虑
- 很低：可能疲惫、低活力、迟缓

### 当前代码里一个很关键的现实问题

[patterns.py](../../william_algorithm/voice/audio_pipeline/layer3/patterns.py) 在算 `speech_pace_tpm` 时，明确依赖：

- `summary.transcript`

但当前 [events.py](../../william_algorithm/voice/audio_pipeline/layer2/events.py) 生成的 `summary` 里并没有把 transcript 带进去。

所以现在这条链路的真实状态更接近：

- Whisper 确实转出了整段文本
- 但事件层没有把文本片段接到 PatternAnalyzer
- 结果 `speech_pace_tpm` 很可能经常接近 `0`

这会直接影响：

- `baseline_deviation.speech_pace`
- `HIGH_COGNITIVE_PRESSURE_ALERT`
- 最后的 `voice_stress`

所以这不是调参问题，而是：

`ASR 文本没有真正接入 pace 计算链路`

---

## 17. `vocal_vitality` 怎么算

它不是音量，也不是单纯情绪强度。

当前定义是：

- 把这些情绪持续时间加起来当作 `vital_time`
  - `hap`
  - `neu`
  - `ang`
  - `sur`
- 再除以总情绪时间

即：

`vocal_vitality = vital_time / total_emo_time`

这其实是一个很工程化的启发式：

- 把“完全低能量、塌陷式”的情绪相对排除掉
- 把“有反应、有张力、有存在感”的发声算作更有 vitality

所以它不是临床定义，而是：

`一种产品化的声音生命力分数。`

---

## 18. `emotional_stability` 怎么算

先取整段事件序列里的情绪顺序：

- `emotion_sequence`

然后数：

- 相邻情绪切换了多少次 `switches`

最后：

`stability = 1.0 - (switches / len(emotion_sequence))`

如果只有一个情绪或没什么变化：

- 接近 `1.0`

如果几乎每个片段都在跳：

- 会更低

所以它不是“情绪平静度”，更准确说是：

`情绪标签在时间轴上的稳定程度。`

这里也要注意：

如果 segment 本身切得太碎，`emotion_sequence` 会被人为拉长，稳定性就会偏低。

所以当前 `emotional_stability` 不只是情绪模型质量问题，也受：

- `StateClassifier`
- `SegmentMerger`

的切段方式直接影响。

---

## 19. `dominant_vibe` 怎么算

很直接：

- 统计情绪标签出现次数
- 取最多的那个

没有更复杂的加权。

所以它不是“最强烈的一瞬间情绪”，而是：

`整段分析里占比最高的情绪标签。`

---

## 20. `clinical_flags` 怎么算

当前不是模型直接输出，而是规则生成。

规则在 `PatternAnalyzer._generate_flags()`：

- `speech_density < 0.02` -> `SOCIAL_WITHDRAWAL_RISK`
- `vitality < 0.2` -> `LOW_VITALITY_LETHARGY_RISK`
- `pace > 250` -> `HIGH_COGNITIVE_PRESSURE_ALERT`

这类 flag 的意义更像：

`给后面的 stress 计算和产品逻辑提供警示标签`

不是医学诊断。

---

## 21. 最后一步：`voice_stress` 是怎么压出来的

文件：

- [voice_service.py](../../william_algorithm/voice/voice_service.py)

函数：

- `derive_voice_stress()`

这是当前系统里**最像“产品评分器”**的一段。

它不是模型端到端预测，而是：

`拿一堆已算好的中间指标，再按规则加减分。`

### 起始分

- `stress = 4.8`

### 语速加权

- `pace >= 220` -> `+2.0`
- `pace >= 180` -> `+1.1`
- `pace <= 85` 且 `> 0` -> `+0.6`

意思是：

- 太快，很像压力上扬
- 太慢，也不一定健康，可能是低能量或异常迟缓

### 稳定性加权

- `stability < 0.4` -> `+1.5`
- `stability < 0.65` -> `+0.7`

### 活力加权

- `vitality < 0.25` -> `+1.0`
- `vitality < 0.4` -> `+0.5`

### 社交密度加权

- `density > 0.45` -> `+0.4`

### 主情绪加权

- `dominant in {ang, exc, fear, anxious}` -> `+1.0`
- `dominant in {sad, fru}` -> `+0.6`
- `dominant in {hap, joy}` -> `-0.4`

### clinical flags 加权

- `HIGH_COGNITIVE_PRESSURE_ALERT` -> `+1.4`
- `LOW_VITALITY_LETHARGY_RISK` -> `+0.8`
- `SOCIAL_WITHDRAWAL_RISK` -> `+0.4`

最后再限制到：

- `1.0 ~ 10.0`

所以 `voice_stress` 的本质不是模型直接预测，而是：

`一个规则化、可解释、可调参的综合分。`

这里最重要的现实判断是：

- 它现在是一个“群体启发式分数”
- 不是“相对这个用户自己平时基线的偏移”

也就是说：

- 语速本来就快的人，可能天然更容易被打高
- 活力本来就低的人，也可能长期偏高

所以这条分数目前更适合做：

- 粗粒度状态采样
- 最近趋势参考

不适合做：

- 高置信度个人 stress 诊断
- 长期个体差异精确比较

---

## 22. 这套算法哪些地方是模型，哪些地方是启发式

### 模型成分

- Whisper ASR
- Wav2Vec2 emotion classification
- OpenSMILE 声学特征提取

### 明确的规则/启发式

- RMS 静音阈值
- VAD speech_ratio 判定
- 状态分类
- segment 合并
- 事件命名
- speech pace / vitality / stability 计算
- clinical flags
- `voice_stress` 打分

所以 William 当前音频算法的风格不是“一个大模型全包”，而是：

`模型负责识别底层信号，规则负责把底层信号翻译成产品可用指标。`

---

## 23. 这套算法最真实的优点

### 1) 可解释

为什么 stress 高，可以追溯：

- 是 pace 太快
- 还是 stability 太低
- 还是 vitality 太低
- 还是 flags 被打上去了

### 2) 不依赖单一黑盒

就算某个情绪模型不稳定，其他指标仍然还能工作。

### 3) 适合产品调参

例如：

- 觉得现在压力太容易偏高
- 你可以调 `pace` 的加权
- 而不是只能换整个模型

---

## 24. 这套算法当前最明显的边界

### 1) `voice_stress` 目前仍然很 heuristic

它是合理的工程近似，但不是医学上被验证的 stress estimator。

### 2) 情绪模型对中文环境未必最优

当前 emotion 模型是通用语音情绪分类模型，不是专门为中文情境做的。

### 3) 逐秒 + 3 秒上下文很实用，但仍然比较粗

它更适合做：

- 状态采样
- 粗粒度画像

不适合做：

- 精细会话结构分析
- 多说话人复杂互动分析

### 4) 现在的事件层还是偏 MVP

例如 `SOCIAL_INTERACTION`、`HIGH_AROUSAL_BURST` 这些，很多还是 duration + RMS + emotion 的组合规则，不是复杂行为理解。

### 5) `speech_pace_tpm` 这条链路当前并不完全打通

Whisper 文本有了，但事件摘要没把 transcript 接过去，所以 pace 相关指标现在很可能偏弱或失真。

### 6) stress 还没有用户基线

它现在更像统一公式，不像个人化模型。

---

## 25. 现在最值得优化的 3 个点

如果只按 ROI 排，我会先看这 3 个：

### 1) 把 transcript 真正接进 event / pattern 层

这是最值的一刀。

因为一旦这条链路接通：

- `speech_pace_tpm`
- `baseline_deviation.speech_pace`
- `HIGH_COGNITIVE_PRESSURE_ALERT`
- `voice_stress`

都会变得更像“真的在用说话内容密度”，而不是空转。

### 2) 让 SegmentMerger 真正使用 gap tolerance

现在 `MERGE_GAP_TOLERANCE_SEC` 还没落到实现里。

如果这条补上：

- segment 不会被轻微停顿打碎
- `emotional_stability` 会更稳
- `SOCIAL_INTERACTION` 计数也会更像真实片段

### 3) 给 `voice_stress` 增加用户基线校准

先不用复杂模型，只要做到：

- 当前 chunk 的 pace / vitality / stability
- 相对用户近 7 天或 14 天平均值做偏移

就会比现在单纯用群体阈值更可信。

---

## 26. 如果只记住一句话

`William 的音频算法不是“一个模型直接看音频给结论”，而是先把音频拆成逐秒信号，再通过 Whisper、VAD、情绪模型和一套启发式规则，合成出 transcript、emotion、vitality、stability 和最终的 voice_stress。`
