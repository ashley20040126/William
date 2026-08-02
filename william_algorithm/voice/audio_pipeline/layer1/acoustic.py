import opensmile
import logging
import numpy as np
import pandas as pd
from .. import config

# Global singleton
_SMILE = None

def get_smile_extractor():
    global _SMILE
    if _SMILE is None:
        try:
            # Initialize with eGeMAPSv02 (standard for emotion)
            # Level='LowLevelDescriptors' gives us per-frame features (10ms steps usually)
            # We want metrics for the whole 1-second window (Functionals)? 
            # Actually, for our 1-sec window pipeline, let's use Functionals 
            # (which calculates mean/std/etc over the input)
            # BUT: Functionals in eGeMAPS require longer context usually.
            # Let's use 'LowLevelDescriptors' (LLD) and compute our own simple means for the 1s window
            # to be safe and fast.
            _SMILE = opensmile.Smile(
                feature_set=opensmile.FeatureSet.eGeMAPSv02,
                feature_level=opensmile.FeatureLevel.LowLevelDescriptors,
            )
            logging.info("OpenSMILE initialized with eGeMAPSv02")
        except Exception as e:
            logging.error(f"Failed to init OpenSMILE: {e}")
            return None
    return _SMILE

def extract_acoustic_features(audio_chunk, sample_rate):
    """
    Extracts Jitter, Shimmer, and F0 from a short audio chunk.
    
    Args:
        audio_chunk (np.array): Audio samples (float32).
        sample_rate (int): Sample rate.
        
    Returns:
        dict: { 'jitter': float, 'shimmer': float, 'f0_mean': float }
    """
    smile = get_smile_extractor()
    if smile is None:
        return None

    try:
        # OpenSMILE expects a specific format or file. 
        # The python wrapper supports numpy arrays directly but expects (channel, samples) or just (samples).
        
        # Process directly
        df = smile.process_signal(audio_chunk, sample_rate)
        
        # The LLD (Low Level Descriptors) return a dataframe with time steps (e.g. every 10ms)
        # We need to average them for this 1-second window.
        
        # Key columns in eGeMAPSv02 LLD:
        # F0semitoneFrom27.5Hz_sma3nz (Pitch)
        # jitterLocal_sma3nz (Jitter)
        # shimmerLocaldB_sma3nz (Shimmer)
        
        # Note: 'nz' means non-zero, i.e., only calculated where pitch is detected (voiced segments).
        
        mean_features = df.mean(numeric_only=True)
        
        f0 = mean_features.get('F0semitoneFrom27.5Hz_sma3nz', 0.0)
        jitter = mean_features.get('jitterLocal_sma3nz', 0.0)
        shimmer = mean_features.get('shimmerLocaldB_sma3nz', 0.0)
        loudness = mean_features.get('Loudness_sma3', 0.0)
        
        # Handle NaN (if no voice detected in this chunk)
        if np.isnan(f0): f0 = 0.0
        if np.isnan(jitter): jitter = 0.0
        if np.isnan(shimmer): shimmer = 0.0
        if np.isnan(loudness): loudness = 0.0
        
        return {
            "f0_semitone": float(round(f0, 2)),
            "jitter": float(round(jitter, 4)),
            "shimmer": float(round(shimmer, 4)),
            "loudness_smile": float(round(loudness, 2))
        }
        
    except Exception as e:
        # OpenSMILE might crash on silence or very short chunks
        # logging.debug(f"OpenSMILE extraction failed: {e}")
        return None
