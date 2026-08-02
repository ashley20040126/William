"""
Configuration settings for the audio processing pipeline.
Centralizes all thresholds and parameters for easy tuning.
"""

# Audio settings
SAMPLE_RATE = 16000
CHANNELS = 1  # Mono

# Layer 1: Feature Extraction
WINDOW_SIZE_SEC = 1.0
CONTEXT_WINDOW_SIZE = 3.0 # Analysis window for Emotion/Acoustics (Sliding Window)
RMS_SILENCE_THRESHOLD = 0.01  # Below this is considered silence/noise floor
SNR_THRESHOLD = 2.0           # Simple proxy threshold for quality
CLIPPING_RATIO_THRESHOLD = 0.01 # Max 1% of samples can be clipped
PEAK_AMPLITUDE_CLIPPING = 0.99  # Absolute value considered as "clipped"

# Layer 1: VAD (Voice Activity Detection)
# WebRTC VAD aggressiveness: 0 (least aggressive) to 3 (most aggressive)
VAD_AGGRESSIVENESS = 3
# Fallback energy VAD if WebRTC not available
VAD_ENERGY_THRESHOLD = 0.02

# Layer 2: Event Logic
SPEECH_RATIO_THRESHOLD = 0.3    # >= 30% speech in a window -> SPEECH state
SILENCE_RATIO_THRESHOLD = 0.05  # <= 5% speech -> POTENTIAL SILENCE
MERGE_GAP_TOLERANCE_SEC = 1.0   # Merge speech segments if gap is <= 1s

# Event Durations (for classifying events)
DURATION_PROLONGED_SILENCE_SEC = 10.0 # MVP test value (prod: 300s)
DURATION_SOCIAL_INTERACTION_SEC = 5.0
DURATION_LOW_QUALITY_BLOCK_SEC = 5.0
AROUSAL_RMS_THRESHOLD = 0.1     # Placeholder for high volume/arousal
DURATION_AROUSAL_SEC = 3.0      # Min duration to count as high arousal

# Layer 3: Metrics
# (Add daily goal thresholds here later)

# ASR (Automatic Speech Recognition)
ENABLE_ASR = True
ASR_MODEL_SIZE = "distil-large-v3" # Best balance of speed and accuracy
# options: tiny, base, small, medium, large-v3, distil-large-v3

# LLM Profiling (Layer 3 Extension)
ENABLE_LLM_PROFILING = True
LLM_MODEL_NAME = "gpt-4o-mini" # Needs OPENAI_API_KEY environment variable

# Emotion Recognition (Layer 1 Extension)
ENABLE_EMOTION = True
# Hugging Face model identifier (using a popular IEMOCAP fine-tuned model as default)
# Example: "ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition"
# or generic: "superb/wav2vec2-base-superb-er"
EMOTION_MODEL_NAME = "superb/wav2vec2-base-superb-er"
