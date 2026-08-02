import logging
import torch
import numpy as np
from .. import config

# Global cache for the model to avoid reloading for every segment
_MODEL = None
_PROCESSOR = None
_IS_AVAILABLE = None
_LOAD_FAILED = False

def is_available():
    """Checks if transformers libraries are installed."""
    global _IS_AVAILABLE
    if _IS_AVAILABLE is not None:
        return _IS_AVAILABLE
    
    try:
        import transformers
        _IS_AVAILABLE = True
    except ImportError:
        logging.warning("Emotion recognition disabled: 'transformers' library not found.")
        _IS_AVAILABLE = False
    return _IS_AVAILABLE

def load_model():
    """Loads the model and processor lazily."""
    global _MODEL, _PROCESSOR, _LOAD_FAILED
    
    if _LOAD_FAILED:
        return None, None
    
    if not is_available():
        return None, None

    if _MODEL is not None:
        return _MODEL, _PROCESSOR

    try:
        from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForSequenceClassification
        
        print(f"Loading Emotion Model: {config.EMOTION_MODEL_NAME} ...")
        # For emotion recognition, we often don't need the full processor (tokenizer), just the feature extractor
        _PROCESSOR = Wav2Vec2FeatureExtractor.from_pretrained(config.EMOTION_MODEL_NAME)
        _MODEL = Wav2Vec2ForSequenceClassification.from_pretrained(config.EMOTION_MODEL_NAME)
        _MODEL.eval() # Set to evaluation mode
        print("Emotion Model loaded successfully.")
        
        return _MODEL, _PROCESSOR
    except Exception as e:
        logging.error(f"Failed to load emotion model: {e}")
        _LOAD_FAILED = True # Mark as failed so we don't try again
        return None, None

def predict_emotion(audio_segment, sample_rate=16000):
    """
    Predicts emotion from a short audio segment (numpy array).
    
    Args:
        audio_segment (np.array): 16kHz mono audio data (e.g., 1 second).
        sample_rate (int): Must be 16000.
        
    Returns:
        dict: Top emotion label and scores, e.g., {'label': 'neutral', 'score': 0.9, 'all_scores': {...}}
              Returns None if model fails or library missing.
    """
    if not config.ENABLE_EMOTION:
        return None

    model, processor = load_model()
    if model is None:
        return None

    try:
        # Preprocess audio
        inputs = processor(audio_segment, sampling_rate=sample_rate, return_tensors="pt", padding=True)
        
        with torch.no_grad():
            logits = model(**inputs).logits
        
        # Softmax to get probabilities
        scores = torch.nn.functional.softmax(logits, dim=-1)[0]
        
        # Get labels mapping (id2label)
        id2label = model.config.id2label
        
        # Find top prediction
        top_score, top_id = torch.max(scores, dim=0)
        top_label = id2label[top_id.item()]
        
        # Format all scores
        all_scores = {id2label[i]: float(score) for i, score in enumerate(scores)}
        
        return {
            "top_label": top_label,
            "confidence": float(top_score),
            "distribution": all_scores
        }
        
    except Exception as e:
        logging.error(f"Error during emotion inference: {e}")
        return None
