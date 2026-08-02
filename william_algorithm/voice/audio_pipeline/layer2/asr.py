from faster_whisper import WhisperModel
import numpy as np
import logging

class WhisperTranscriber:
    """
    Handles speech-to-text transcription using faster-whisper.
    """
    def __init__(self, model_size="base", device="cpu", compute_type="int8"):
        """
        Initialize the model. 
        On macOS (Darwin), 'cpu' with 'int8' is usually the safest/fastest for general use.
        For Apple Silicon, you could try device='cpu' with float32 if int8 is slow, 
        or look into mlx-whisper for native optimization.
        """
        logging.info(f"Initializing Whisper model '{model_size}' on {device}...")
        try:
            # Note: For some Apple Silicon Macs, device="auto" might work better, 
            # but device="cpu" is more predictable for a start.
            self.model = WhisperModel(model_size, device=device, compute_type=compute_type)
            logging.info("Whisper model loaded successfully.")
        except Exception as e:
            logging.error(f"Failed to load Whisper model: {e}")
            raise

    def transcribe_slice(self, audio_array: np.ndarray) -> str:
        """
        Transcribes a raw numpy audio array (float32, normalized).
        
        Args:
            audio_array: NumPy array of audio samples (float32, 16kHz recommended).
            
        Returns:
            str: The transcribed text.
        """
        if len(audio_array) == 0:
            return ""

        try:
            # faster-whisper.transcribe returns a generator of segments and info
            # Removing language="zh" to enable auto-detection (ideal for mixed zh/en)
            segments, info = self.model.transcribe(audio_array, beam_size=5)
            
            # Log detected language for visibility
            logging.info(f"Detected language: {info.language} (probability: {info.language_probability:.2f})")

            # Collect all segment texts
            text_parts = [segment.text for segment in segments]
            full_text = "".join(text_parts).strip()
            
            return full_text
        except Exception as e:
            logging.error(f"Transcription error: {e}")
            return "[Error during transcription]"
