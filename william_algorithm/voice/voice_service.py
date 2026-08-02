import asyncio
import base64
import os
import subprocess
import tempfile
import warnings
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from audio_pipeline import config as pipeline_config
from audio_pipeline.layer1 import features
from audio_pipeline.layer2 import events, segment_merge, state_classifier
from audio_pipeline.layer3 import patterns
from audio_pipeline.layer2.asr import WhisperTranscriber

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(dotenv_path=BASE_DIR / ".env")
warnings.filterwarnings(
  "ignore",
  message="pkg_resources is deprecated as an API.*",
  category=UserWarning,
)

SERVICE_HOST = os.getenv("VOICE_SERVICE_HOST", "127.0.0.1")
SERVICE_PORT = int(os.getenv("VOICE_SERVICE_PORT", "8020"))
MODEL_SIZE = os.getenv("VOICE_ASR_MODEL_SIZE", "base")
DEVICE = os.getenv("VOICE_ASR_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("VOICE_ASR_COMPUTE_TYPE", "int8")
PRELOAD_MODEL = os.getenv("VOICE_SERVICE_PRELOAD", "true").lower() not in {"0", "false", "no", "off"}
TARGET_SAMPLE_RATE = int(os.getenv("VOICE_TARGET_SAMPLE_RATE", "16000"))

_transcriber: WhisperTranscriber | None = None
_transcriber_lock = asyncio.Lock()


class TranscribeRequest(BaseModel):
  audio_base64: str = Field(..., min_length=8)
  filename: str = Field(default="voice.webm", max_length=200)
  mime_type: str = Field(default="audio/webm", max_length=120)
  skip_transcription: bool = False


class TranscribeResponse(BaseModel):
  text: str
  language: str | None = None
  duration_ms: int


class AnalyzeResponse(BaseModel):
  text: str
  language: str | None = None
  duration_ms: int
  voice_stress: float
  speech_detected: bool
  dominant_emotion: str
  speech_pace_tpm: float
  emotional_stability: float
  vocal_vitality: float
  flags: list[str] = []


async def get_transcriber() -> WhisperTranscriber:
  global _transcriber
  if _transcriber is not None:
    return _transcriber

  async with _transcriber_lock:
    if _transcriber is not None:
      return _transcriber

    _transcriber = await asyncio.to_thread(
      WhisperTranscriber,
      MODEL_SIZE,
      DEVICE,
      COMPUTE_TYPE,
    )
    return _transcriber


@asynccontextmanager
async def lifespan(_: FastAPI):
  if PRELOAD_MODEL:
    await get_transcriber()
  yield


app = FastAPI(title="William Voice Service", lifespan=lifespan)


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(request: TranscribeRequest):
  try:
    audio_bytes = base64.b64decode(request.audio_base64)
  except Exception as exc:
    raise HTTPException(status_code=400, detail="Invalid audio payload") from exc

  suffix = Path(request.filename or "voice.webm").suffix or guess_suffix(request.mime_type)

  with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_file:
    tmp_file.write(audio_bytes)
    tmp_path = Path(tmp_file.name)

  try:
    audio, sample_rate = await asyncio.to_thread(
      decode_audio_file,
      tmp_path,
      TARGET_SAMPLE_RATE,
    )
    duration_ms = int((len(audio) / sample_rate) * 1000)
    if duration_ms < 120:
      return TranscribeResponse(text="", language=None, duration_ms=duration_ms)
    transcriber = await get_transcriber()
    text = await asyncio.to_thread(transcriber.transcribe_slice, np.asarray(audio, dtype=np.float32))

    if text == "[Error during transcription]":
      raise HTTPException(status_code=500, detail="ASR transcription failed")

    return TranscribeResponse(
      text=text.strip(),
      language=None,
      duration_ms=duration_ms,
    )
  except HTTPException:
    raise
  except Exception as exc:
    if is_invalid_audio_decode_error(exc):
      return TranscribeResponse(text="", language=None, duration_ms=0)
    print(f"[Voice Service] Transcription failed: {exc!r}")
    raise HTTPException(status_code=500, detail="Voice transcription failed") from exc
  finally:
    tmp_path.unlink(missing_ok=True)


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(request: TranscribeRequest):
  try:
    audio_bytes = base64.b64decode(request.audio_base64)
  except Exception as exc:
    raise HTTPException(status_code=400, detail="Invalid audio payload") from exc

  suffix = Path(request.filename or "voice.webm").suffix or guess_suffix(request.mime_type)

  with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp_file:
    tmp_file.write(audio_bytes)
    tmp_path = Path(tmp_file.name)

  try:
    audio, sample_rate = await asyncio.to_thread(
      decode_audio_file,
      tmp_path,
      TARGET_SAMPLE_RATE,
    )
    duration_ms = int((len(audio) / sample_rate) * 1000)
    if duration_ms < 800:
      raise HTTPException(status_code=422, detail="Audio too short to analyze")

    text = ""
    if not request.skip_transcription:
      transcriber = await get_transcriber()
      text = await asyncio.to_thread(transcriber.transcribe_slice, np.asarray(audio, dtype=np.float32))
      if text == "[Error during transcription]":
        raise HTTPException(status_code=500, detail="ASR transcription failed")

    analysis = await asyncio.to_thread(run_voice_analysis, np.asarray(audio, dtype=np.float32), sample_rate)
    return AnalyzeResponse(
      text=text.strip(),
      language=None,
      duration_ms=duration_ms,
      voice_stress=analysis["voice_stress"],
      speech_detected=analysis["speech_detected"],
      dominant_emotion=analysis["dominant_emotion"],
      speech_pace_tpm=analysis["speech_pace_tpm"],
      emotional_stability=analysis["emotional_stability"],
      vocal_vitality=analysis["vocal_vitality"],
      flags=analysis["flags"],
    )
  except HTTPException:
    raise
  except Exception as exc:
    print(f"[Voice Service] Analyze failed: {exc!r}")
    raise HTTPException(status_code=500, detail="Voice analysis failed") from exc
  finally:
    tmp_path.unlink(missing_ok=True)


@app.get("/health")
async def health():
  return {
    "status": "ok",
    "model_size": MODEL_SIZE,
    "device": DEVICE,
    "preloaded": _transcriber is not None,
  }


def guess_suffix(mime_type: str) -> str:
  mapping = {
    "audio/webm": ".webm",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
  }
  return mapping.get(mime_type, ".webm")


def is_invalid_audio_decode_error(error: Exception) -> bool:
  message = str(error)
  return (
    "Invalid data found when processing input" in message
    or "EBML header parsing failed" in message
    or "Error opening input file" in message
  )


def decode_audio_file(path: Path, target_sample_rate: int) -> tuple[np.ndarray, int]:
  command = [
    "ffmpeg",
    "-nostdin",
    "-v",
    "error",
    "-i",
    str(path),
    "-f",
    "f32le",
    "-acodec",
    "pcm_f32le",
    "-ac",
    "1",
    "-ar",
    str(target_sample_rate),
    "pipe:1",
  ]

  try:
    result = subprocess.run(command, capture_output=True, check=False)
  except FileNotFoundError as exc:
    raise RuntimeError("ffmpeg is not installed or not on PATH") from exc
  if result.returncode != 0:
    stderr = result.stderr.decode("utf-8", errors="ignore").strip()
    raise RuntimeError(stderr or "ffmpeg decode failed")

  audio = np.frombuffer(result.stdout, dtype=np.float32)
  if audio.size == 0:
    raise RuntimeError("decoded audio is empty")
  return audio, target_sample_rate


def run_voice_analysis(audio: np.ndarray, sample_rate: int) -> dict:
  duration_s = len(audio) / sample_rate if sample_rate > 0 else 0
  extractor = features.FeatureExtractor()
  l1_features = list(extractor.process_file(audio, duration_s))
  if not l1_features:
    return {
      "voice_stress": 5.0,
      "speech_detected": False,
      "dominant_emotion": "neutral",
      "speech_pace_tpm": 0.0,
      "emotional_stability": 1.0,
      "vocal_vitality": 0.5,
      "flags": [],
    }

  classifier = state_classifier.StateClassifier()
  classified_stream = [(feature, classifier.classify_second(feature)) for feature in l1_features]
  merger = segment_merge.SegmentMerger()
  merged_segments = merger.merge_stream(classified_stream)
  event_generator = events.EventGenerator()
  generated_events = event_generator.process_segments(merged_segments)
  speech_active_seconds = sum(
    1
    for feature in l1_features
    if float(feature.get("vad", {}).get("speech_ratio") or 0.0) >= pipeline_config.SPEECH_RATIO_THRESHOLD
  )

  original_llm_flag = pipeline_config.ENABLE_LLM_PROFILING
  try:
    pipeline_config.ENABLE_LLM_PROFILING = False
    analyzer = patterns.PatternAnalyzer()
    report = analyzer.analyze_daily(generated_events, duration_s)
  finally:
    pipeline_config.ENABLE_LLM_PROFILING = original_llm_flag

  biomarkers = report.get("vocal_biomarkers", {})
  flags = report.get("clinical_flags", []) or []
  dominant_emotion = str(biomarkers.get("dominant_vibe") or "neutral")
  speech_pace = float(biomarkers.get("speech_pace_tpm") or 0.0)
  stability = float(biomarkers.get("emotional_stability") or 1.0)
  vitality = float(biomarkers.get("vocal_vitality") or 0.5)

  return {
    "voice_stress": derive_voice_stress(report),
    "speech_detected": speech_active_seconds >= 1,
    "dominant_emotion": dominant_emotion,
    "speech_pace_tpm": round(speech_pace, 1),
    "emotional_stability": round(stability, 2),
    "vocal_vitality": round(vitality, 2),
    "flags": [str(flag) for flag in flags],
  }


def derive_voice_stress(report: dict) -> float:
  biomarkers = report.get("vocal_biomarkers", {})
  social = report.get("social_health", {})
  flags = set(report.get("clinical_flags", []) or [])
  dominant = str(biomarkers.get("dominant_vibe") or "neutral")
  pace = float(biomarkers.get("speech_pace_tpm") or 0.0)
  stability = float(biomarkers.get("emotional_stability") or 1.0)
  vitality = float(biomarkers.get("vocal_vitality") or 0.5)
  density = float(social.get("speech_density") or 0.0)

  stress = 4.8

  if pace >= 220:
    stress += 2.0
  elif pace >= 180:
    stress += 1.1
  elif pace > 0 and pace <= 85:
    stress += 0.6

  if stability < 0.4:
    stress += 1.5
  elif stability < 0.65:
    stress += 0.7

  if vitality < 0.25:
    stress += 1.0
  elif vitality < 0.4:
    stress += 0.5

  if density > 0.45:
    stress += 0.4

  if dominant in {"ang", "exc", "fear", "anxious"}:
    stress += 1.0
  elif dominant in {"sad", "fru"}:
    stress += 0.6
  elif dominant in {"hap", "joy"}:
    stress -= 0.4

  if "HIGH_COGNITIVE_PRESSURE_ALERT" in flags:
    stress += 1.4
  if "LOW_VITALITY_LETHARGY_RISK" in flags:
    stress += 0.8
  if "SOCIAL_WITHDRAWAL_RISK" in flags:
    stress += 0.4

  return round(max(1.0, min(10.0, stress)), 1)


if __name__ == "__main__":
  import uvicorn

  uvicorn.run(app, host=SERVICE_HOST, port=SERVICE_PORT)
