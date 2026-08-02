import numpy as np
from . import vad, quality, emotion, acoustic
from .. import config

class FeatureExtractor:
    def __init__(self):
        self.vad_processor = vad.VAD(sample_rate=config.SAMPLE_RATE)
        # Pre-initialize OpenSMILE to avoid first-run lag
        acoustic.get_smile_extractor()

    def process_file(self, audio_data, total_duration):
        """
        Generates a stream of feature dictionaries (one per second).
        Uses a sliding window approach for context-aware features (Emotion, Acoustics).
        """
        sample_rate = config.SAMPLE_RATE
        step_size = int(config.WINDOW_SIZE_SEC * sample_rate)
        context_size = int(config.CONTEXT_WINDOW_SIZE * sample_rate)
        
        # Iterate over audio with step_size (1s), but extract context_size (3s) for analysis
        for i in range(0, len(audio_data), step_size):
            # 1. Basic 1s Window (For VAD & Time Alignment)
            # This determines "what is happening at this specific second"
            basic_chunk = audio_data[i:i+step_size]
            
            # If basic chunk is too small (end of file), skip or pad
            if len(basic_chunk) < sample_rate * 0.5:
                continue
                
            ts_ms = int((i / sample_rate) * 1000)
            
            # --- BASE LAYER: VAD & SIGNAL (1s precision) ---
            rms = np.sqrt(np.mean(basic_chunk**2))
            peak = np.max(np.abs(basic_chunk))
            clipping_ratio = np.sum(np.abs(basic_chunk) >= config.PEAK_AMPLITUDE_CLIPPING) / len(basic_chunk)
            snr_proxy = rms / (config.RMS_SILENCE_THRESHOLD + 1e-9)
            
            speech_ratio = self.vad_processor.process_window(basic_chunk)
            
            quality_flag = "OK"
            if clipping_ratio > config.CLIPPING_RATIO_THRESHOLD:
                quality_flag = "LOW_QUALITY_CLIPPING"
            elif snr_proxy < config.SNR_THRESHOLD:
                quality_flag = "LOW_QUALITY_NOISE"

            # --- CONTEXT LAYER: EMOTION & ACOUSTICS (3s sliding window) ---
            emotion_result = None
            acoustic_result = None
            
            # Only run heavy models if this second is "active"
            is_active = speech_ratio > 0.1 or rms > config.RMS_SILENCE_THRESHOLD * 2
            
            if is_active and quality_flag == "OK":
                # Grab a larger context window: [current_time, current_time + 3s]
                # We clamp to the end of the file
                end_idx = min(i + context_size, len(audio_data))
                context_chunk = audio_data[i : end_idx]
                
                # Only run if we have enough context (at least 1s)
                if len(context_chunk) >= sample_rate:
                    # Run Acoustic Analysis (Jitter, Shimmer, F0)
                    acoustic_result = acoustic.extract_acoustic_features(context_chunk, sample_rate)
                    
                    # Run Emotion (Only if strong speech in the base window)
                    if speech_ratio >= config.SPEECH_RATIO_THRESHOLD and config.ENABLE_EMOTION:
                        emotion_result = emotion.predict_emotion(context_chunk)

            yield {
                "ts_ms": ts_ms,
                "vad": {
                    "speech_ratio": round(speech_ratio, 3)
                },
                "signal": {
                    "rms_mean": round(float(rms), 4),
                    "peak_max": round(float(peak), 4),
                    "clipping_ratio": round(float(clipping_ratio), 4),
                    "snr_proxy": round(float(snr_proxy), 2)
                },
                "quality": {
                    "flag": quality_flag
                },
                "acoustic": acoustic_result,
                "emotion": emotion_result
            }
