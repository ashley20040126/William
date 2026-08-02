from .. import config

class StateClassifier:
    def classify_second(self, feature_dict):
        """
        Classifies a single second of data into a primary state.
        
        Args:
            feature_dict (dict): One record from Layer 1 output.
            
        Returns:
            str: State label (SPEECH, SILENCE, LOW_QUALITY, UNKNOWN)
        """
        vad = feature_dict['vad']['speech_ratio']
        quality_flag = feature_dict['quality']['flag']
        rms = feature_dict['signal']['rms_mean']
        
        # Priority 1: Bad Quality
        if quality_flag != "OK":
            return "LOW_QUALITY"
            
        # Priority 2: Speech
        if vad >= config.SPEECH_RATIO_THRESHOLD:
            return "SPEECH"
            
        # Priority 3: Silence
        # Must be low speech ratio AND low volume
        if vad <= config.SILENCE_RATIO_THRESHOLD and rms <= config.RMS_SILENCE_THRESHOLD:
            return "SILENCE"
        
        # Priority 4: Ambiguous / Noise that isn't speech
        return "UNKNOWN"
