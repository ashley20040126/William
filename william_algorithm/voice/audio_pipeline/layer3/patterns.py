from collections import Counter, defaultdict
import numpy as np
import re
from .. import config

# Import the new LLM profiler (it will gracefully degrade if openai is not installed/configured)
try:
    from .profiler_llm import LLMProfiler
except ImportError:
    LLMProfiler = None

class PatternAnalyzer:
    def analyze_daily(self, events, total_duration_s):
        """
        Generates comprehensive behavioral and health insights from the event stream.
        Aggregates metrics across four key dimensions:
        1. Social Activity (Verified Density)
        2. Vocal Vitality & Pace (Energy/Cognitive Load)
        3. Emotional Stability
        4. Temporal Patterns
        """
        
        # --- 1. Basic Aggregation ---
        raw_speech_dur = 0.0
        verified_speech_dur = 0.0
        total_tokens = 0
        social_events = []
        
        emotion_counter = Counter()
        emotion_durations = defaultdict(float)
        emotion_sequence = []
        
        for ev in events:
            dur = ev['duration_s']
            etype = ev['type']
            summary = ev.get('summary', {})
            transcript = summary.get('transcript', "").strip()
            
            # Speech Metrics
            if "SOCIAL_INTERACTION" in etype or "SPEECH" in etype:
                raw_speech_dur += dur
                
                # Verified Speech: Only count if ASR actually found words
                if transcript:
                    verified_speech_dur += dur
                    # Heuristic for token count (Eng words + CJK chars)
                    # This gives a rough 'content volume'
                    total_tokens += len(transcript.split()) + len(re.findall(r'[\u4e00-\u9fff]', transcript))
                
                if "SOCIAL_INTERACTION" in etype:
                    social_events.append(ev)
                
            # Emotional Metrics
            dom_emo = summary.get('dominant_emotion')
            if dom_emo:
                emotion_counter[dom_emo] += 1
                emotion_durations[dom_emo] += dur
                emotion_sequence.append(dom_emo)

        # --- 2. Advanced Derived Metrics ---
        
        # A. Verified Speech Density (0.0 to 1.0)
        # Filters out environmental noise that VAD might trip on
        speech_density = verified_speech_dur / total_duration_s if total_duration_s > 0 else 0
        
        # B. Speech Pace (Tokens per Minute)
        # High pace = Anxiety/Stress | Low pace = Fatigue/Depression
        speech_pace_tpm = (total_tokens / (verified_speech_dur / 60)) if verified_speech_dur > 1 else 0
        
        # C. Vocal Vitality (0.0 to 1.0)
        vital_time = (emotion_durations.get('hap', 0) + 
                      emotion_durations.get('neu', 0) + 
                      emotion_durations.get('ang', 0) +
                      emotion_durations.get('sur', 0))
        total_emo_time = sum(emotion_durations.values())
        vocal_vitality = vital_time / total_emo_time if total_emo_time > 0 else 0.5
        
        # D. Emotional Stability (0.0 to 1.0)
        # Calculated by normalized emotion switches
        switches = 0
        for i in range(1, len(emotion_sequence)):
            if emotion_sequence[i] != emotion_sequence[i-1]:
                switches += 1
        
        # Stability = 1.0 (consistent) -> 0.0 (erratic)
        stability = 1.0 - (switches / len(emotion_sequence)) if len(emotion_sequence) > 1 else 1.0
        
        primary_emotion = emotion_counter.most_common(1)[0][0] if emotion_counter else "neutral"

        # --- 3. Baseline Comparison ---
        baseline_comparison = {}
        
        if speech_density < 0.05 and total_duration_s > 60:
            baseline_comparison["social_volume"] = "lower_than_usual"
        
        if speech_pace_tpm > 0:
            if speech_pace_tpm < 80: # Very slow
                baseline_comparison["speech_pace"] = "slower_than_usual"
            elif speech_pace_tpm > 200: # Very fast/pressured
                baseline_comparison["speech_pace"] = "faster_than_usual"
             
        if vocal_vitality < 0.3:
            baseline_comparison["vocal_vitality"] = "lower_than_usual"

        # --- 4. Construct Final Report ---
        report = {
            "meta": {
                "total_analyzed_duration_s": round(total_duration_s, 2),
                "verified_speech_ratio": round(verified_speech_dur / raw_speech_dur, 2) if raw_speech_dur > 0 else 0
            },
            "social_health": {
                "verified_speech_duration_s": round(verified_speech_dur, 1),
                "interaction_count": len(social_events),
                "speech_density": round(speech_density, 3) 
            },
            "vocal_biomarkers": {
                "vocal_vitality": round(vocal_vitality, 2),
                "speech_pace_tpm": round(speech_pace_tpm, 1), # Tokens Per Minute
                "emotional_stability": round(stability, 2),
                "dominant_vibe": primary_emotion
            },
            "baseline_deviation": baseline_comparison,
            "clinical_flags": self._generate_flags(speech_density, vocal_vitality, speech_pace_tpm)
        }
        
        # --- 5. Deep LLM Profiling ---
        if getattr(config, 'ENABLE_LLM_PROFILING', False) and LLMProfiler:
            profiler = LLMProfiler(model_name=getattr(config, 'LLM_MODEL_NAME', 'gpt-4o-mini'))
            llm_result = profiler.analyze(events)
            report["psychological_profile"] = llm_result

        return report

    def _generate_flags(self, density, vitality, pace):
        flags = []
        if 0 < density < 0.02:
            flags.append("SOCIAL_WITHDRAWAL_RISK")
        if vitality < 0.2:
            flags.append("LOW_VITALITY_LETHARGY_RISK")
        if pace > 250:
            flags.append("HIGH_COGNITIVE_PRESSURE_ALERT")
        return flags
