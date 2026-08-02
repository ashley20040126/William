import numpy as np
import logging
from .. import config

# Try to import webrtcvad
try:
    import webrtcvad
    _HAS_WEBRTC = True
except ImportError:
    _HAS_WEBRTC = False
    logging.warning("webrtcvad not installed. Falling back to energy-based VAD.")

class VAD:
    def __init__(self, sample_rate=16000):
        self.sample_rate = sample_rate
        self.vad = None
        if _HAS_WEBRTC:
            self.vad = webrtcvad.Vad(config.VAD_AGGRESSIVENESS)

    def is_speech_webrtc(self, frame_bytes):
        """
        Uses WebRTC VAD. Frame must be 10, 20, or 30 ms.
        """
        try:
            return self.vad.is_speech(frame_bytes, self.sample_rate)
        except Exception:
            return False

    def process_window(self, audio_window):
        """
        Analyzes a 1-second window and returns the speech ratio (0.0 to 1.0).
        
        Args:
            audio_window (np.array): Float array of audio samples (approx 1 sec).
        
        Returns:
            float: Ratio of speech detected in this window (e.g., 0.6 means 60% of the second was speech).
        """
        # If signal is too quiet (digital silence), force 0
        rms = np.sqrt(np.mean(audio_window**2))
        if rms < config.RMS_SILENCE_THRESHOLD:
            return 0.0

        if _HAS_WEBRTC:
            return self._process_webrtc(audio_window)
        else:
            return self._process_energy(rms)

    def _process_energy(self, rms):
        """Simple fallback: if RMS > threshold, it's speech."""
        return 1.0 if rms > config.VAD_ENERGY_THRESHOLD else 0.0

    def _process_webrtc(self, audio_window):
        """
        WebRTC VAD works on 16-bit PCM integer data and 10/20/30ms frames.
        Our input is Float32.
        """
        # Convert float32 to int16
        pcm_data = (audio_window * 32768).astype(np.int16)
        
        # Frame size: 30ms at 16000Hz = 480 samples
        frame_duration_ms = 30
        frame_size = int(self.sample_rate * frame_duration_ms / 1000)
        
        speech_frames = 0
        total_frames = 0
        
        for i in range(0, len(pcm_data) - frame_size, frame_size):
            frame = pcm_data[i:i+frame_size]
            if self.vad.is_speech(frame.tobytes(), self.sample_rate):
                speech_frames += 1
            total_frames += 1
            
        if total_frames == 0:
            return 0.0
            
        return speech_frames / total_frames
