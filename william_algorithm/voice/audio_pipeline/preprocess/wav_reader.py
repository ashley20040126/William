import librosa
import numpy as np
import soundfile as sf
import os
try:
    import noisereduce as nr
except ImportError:
    nr = None
from .. import config

def read_audio(file_path):
    """
    Reads an audio file and converts it to the target sample rate and mono channel.
    Optional noise reduction is applied if ENABLE_DENOISE environment variable is set.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Audio file not found: {file_path}")

    try:
        audio, sr = librosa.load(file_path, sr=config.SAMPLE_RATE, mono=True)
        
        # --- Objective Experiment: Noise Reduction ---
        if os.getenv("ENABLE_DENOISE") == "1" and nr is not None:
            # Using stationary noise reduction for consistent background suppression
            audio = nr.reduce_noise(y=audio, sr=sr, prop_decrease=0.8)
        
        return audio, sr
    except Exception as e:
        raise RuntimeError(f"Failed to process audio file {file_path}: {e}")

def get_duration(audio_data, sample_rate):
    """Calculates duration in seconds."""
    return len(audio_data) / sample_rate
