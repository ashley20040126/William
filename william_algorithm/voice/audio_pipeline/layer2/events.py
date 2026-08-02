from .. import config
import numpy as np

class EventGenerator:
    def process_segments(self, segments):
        """
        Takes raw merged segments and converts them into high-level business events.
        Also computes summary statistics for each segment.
        """
        events = []
        
        for seg in segments:
            # 1. Compute Summaries
            summary = self._compute_summary(seg)
            
            # 2. Determine Event Type and Confidence
            event_type, confidence = self._classify_event_type(seg['type'], seg['duration_s'], summary)
            
            # 3. Construct Event Object
            event = {
                "type": event_type,
                "start_ts_ms": seg['start_ts_ms'],
                "end_ts_ms": seg['end_ts_ms'],
                "duration_s": round(seg['duration_s'], 2),
                "confidence": round(confidence, 2),
                "summary": summary
            }
            
            # Only keep "interesting" events or keep all? 
            # For MVP, let's keep everything but maybe mark "BACKGROUND" for short/boring stuff
            if event_type == "BACKGROUND_NOISE" or event_type == "SHORT_SPEECH":
                # Optional: Filter these out if you only want "Major" events
                pass
                
            events.append(event)
            
        return events

    def _compute_summary(self, seg):
        feats = seg['features_accumulator']
        
        # Signal Metrics
        rms_values = [f['signal']['rms_mean'] for f in feats]
        rms_avg = float(np.mean(rms_values)) if rms_values else 0.0
        
        # Acoustic Metrics (Collect valid values)
        jitters = [f['acoustic']['jitter'] for f in feats if f.get('acoustic') and f['acoustic']['jitter'] is not None]
        shimmers = [f['acoustic']['shimmer'] for f in feats if f.get('acoustic') and f['acoustic']['shimmer'] is not None]
        f0s = [f['acoustic']['f0_semitone'] for f in feats if f.get('acoustic') and f['acoustic']['f0_semitone'] > 0]
        
        avg_jitter = float(np.mean(jitters)) if jitters else None
        avg_shimmer = float(np.mean(shimmers)) if shimmers else None
        avg_f0 = float(np.mean(f0s)) if f0s else None
        
        # Emotion Dominance
        total_emotions = sum(seg['emotion_counts'].values())
        dominant_emotion = "neutral"
        emotion_confidence = 0.0
        
        if total_emotions > 0:
            best_emo, count = seg['emotion_counts'].most_common(1)[0]
            dominant_emotion = best_emo
            emotion_confidence = count / total_emotions
            
        return {
            "rms_mean": round(rms_avg, 4),
            "acoustic": {
                "avg_jitter": round(avg_jitter, 4) if avg_jitter else None,
                "avg_shimmer": round(avg_shimmer, 4) if avg_shimmer else None,
                "avg_f0": round(avg_f0, 2) if avg_f0 else None
            },
            "dominant_emotion": dominant_emotion,
            "emotion_confidence": round(emotion_confidence, 2),
            "emotion_distribution": dict(seg['emotion_counts'])
        }

    def _classify_event_type(self, raw_type, duration, summary):
        if raw_type == "SPEECH":
            # Baseline confidence based on physical duration and energy
            confidence = 0.5 + min(duration / 10.0, 0.3) 
            
            # Emotion as a modifier, not a definer
            emo = summary['dominant_emotion']
            emo_conf = summary['emotion_confidence']
            if emo in ['hap', 'ang', 'exc'] and emo_conf > 0.5:
                # High energy emotions increase confidence of it being an interaction or burst
                confidence += 0.2
            
            if duration >= config.DURATION_SOCIAL_INTERACTION_SEC:
                # In a fully implemented v1.2, we would analyze speaker_turns and pause_rhythm here.
                # For this MVP simulation, duration + moderate energy indicates potential interaction.
                # If energy is extremely high, it might be an arousal burst.
                if summary['rms_mean'] > config.AROUSAL_RMS_THRESHOLD:
                     return "HIGH_AROUSAL_BURST", min(confidence + 0.1, 1.0)
                return "SOCIAL_INTERACTION", min(confidence, 1.0)
            else:
                return "SHORT_SPEECH", confidence
                
        elif raw_type == "SILENCE":
            if duration >= config.DURATION_PROLONGED_SILENCE_SEC:
                return "PROLONGED_SILENCE", 1.0
            else:
                return "SHORT_SILENCE", 1.0
                
        elif raw_type == "LOW_QUALITY":
            if duration >= config.DURATION_LOW_QUALITY_BLOCK_SEC:
                return "LOW_QUALITY_BLOCK", 1.0
            else:
                return "NOISE_GLITCH", 1.0
                
        return "UNKNOWN_ACTIVITY", 0.0
