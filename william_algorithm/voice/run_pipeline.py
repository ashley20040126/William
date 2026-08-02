import argparse
import os
import json
import logging
from datetime import datetime
from dotenv import load_dotenv, find_dotenv

# Load .env from current or parent directories (crucial for finding keys in /william_algorithm/)
load_dotenv(find_dotenv())

from audio_pipeline.preprocess import wav_reader
from audio_pipeline.layer1 import features
from audio_pipeline.layer2 import state_classifier, segment_merge, events, asr
from audio_pipeline.layer3 import patterns, profiler_llm
from audio_pipeline import config

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

def main():
    parser = argparse.ArgumentParser(description="Run Audio Analysis Pipeline")
    parser.add_argument("input_file", help="Path to input audio file")
    parser.add_argument("--outdir", default="out", help="Output directory")
    parser.add_argument("--no-asr", action="store_true", help="Disable ASR transcription")
    args = parser.parse_args()

    # Ensure output dir exists
    os.makedirs(args.outdir, exist_ok=True)
    
    # 1. READ AUDIO
    logging.info(f"Reading audio file: {args.input_file}")
    try:
        audio, sr = wav_reader.read_audio(args.input_file)
        duration = wav_reader.get_duration(audio, sr)
        logging.info(f"Audio loaded. Duration: {duration:.2f}s")
    except Exception as e:
        logging.error(f"Failed to read audio: {e}")
        return

    # 2. LAYER 1: Feature Extraction
    logging.info("Running Layer 1: Feature Extraction...")
    extractor = features.FeatureExtractor()
    l1_features = []
    
    # Stream process
    for feat in extractor.process_file(audio, duration):
        l1_features.append(feat)
        
    # Save Layer 1
    l1_path = os.path.join(args.outdir, "features.jsonl")
    with open(l1_path, "w") as f:
        for item in l1_features:
            f.write(json.dumps(item) + "\n")
    logging.info(f"Layer 1 output saved to {l1_path}")

    # 3. LAYER 2: Events
    logging.info("Running Layer 2: Event Generation...")
    
    # 2a. Classify States
    classifier = state_classifier.StateClassifier()
    classified_stream = [(f, classifier.classify_second(f)) for f in l1_features]
    
    # 2b. Merge Segments
    merger = segment_merge.SegmentMerger()
    merged_segments = merger.merge_stream(classified_stream)
    
    # 2c. Generate Business Events
    event_gen = events.EventGenerator()
    l2_events = event_gen.process_segments(merged_segments)

    # 2d. Run ASR (Transcription)
    if config.ENABLE_ASR and not args.no_asr:
        logging.info(f"Running ASR (Whisper {config.ASR_MODEL_SIZE})...")
        transcriber = asr.WhisperTranscriber(model_size=config.ASR_MODEL_SIZE)
        
        for event in l2_events:
            # We only transcribe speech-related events
            if "SOCIAL_INTERACTION" in event["type"] or event["type"] == "SHORT_SPEECH":
                start_ms = event["start_ts_ms"]
                end_ms = event["end_ts_ms"]
                
                # Slicing the global audio array
                start_idx = int(start_ms / 1000.0 * sr)
                end_idx = int(end_ms / 1000.0 * sr)
                
                audio_slice = audio[start_idx:end_idx]
                if len(audio_slice) > 0:
                    text = transcriber.transcribe_slice(audio_slice)
                    event["summary"]["transcript"] = text
                    # Log a preview
                    preview = (text[:30] + '...') if len(text) > 30 else text
                    logging.info(f"[{start_ms}ms] Transcript: {preview}")
    
    # Save Layer 2
    l2_path = os.path.join(args.outdir, "events.json")
    with open(l2_path, "w") as f:
        json.dump(l2_events, f, indent=2)
    logging.info(f"Layer 2 output saved to {l2_path}")

    # 4. LAYER 3: Patterns
    logging.info("Running Layer 3: Pattern Analysis...")
    analyzer = patterns.PatternAnalyzer()
    l3_report = analyzer.analyze_daily(l2_events, duration)
    
    # Save Layer 3
    l3_path = os.path.join(args.outdir, "patterns.json")
    with open(l3_path, "w") as f:
        json.dump(l3_report, f, indent=2)
    logging.info(f"Layer 3 output saved to {l3_path}")

    # 5. LAYER 4: Interpretation (Psychological Profiling via LLM)
    logging.info("Running Layer 4: Interpretation (LLM Profiling)...")
    profiler = profiler_llm.LLMProfiler()
    l4_report = profiler.analyze(l2_events)
    
    # Save Layer 4
    l4_path = os.path.join(args.outdir, "interpretation.json")
    with open(l4_path, "w") as f:
        json.dump(l4_report, f, indent=2)
    logging.info(f"Layer 4 output saved to {l4_path}")
    
    # Print Summary
    print("\n" + "="*40)
    print(f"ANALYSIS COMPLETE for {args.input_file}")
    print(f"Total Duration: {duration:.2f}s")
    
    soc = l3_report.get('social_health', {})
    emo = l3_report.get('emotional_wellbeing', {})
    
    print(f"Social Interactions: {soc.get('interaction_count', 0)}")
    print(f"Speech Minutes: {soc.get('total_speech_min', 0)} min")
    print(f"Isolation Index: {soc.get('isolation_index', 0)}")
    print(f"Primary Emotion: {emo.get('primary_mood', 'N/A').upper()}")
    print(f"Positivity Ratio: {emo.get('positivity_ratio', 0)}")
    
    if l4_report.get("status") == "success":
        print(f"\n🧠 PSYCHOLOGICAL NARRATIVE (LLM):\n{l4_report.get('narrative_summary')}")
        print(f"\n💡 INTERACTION GUIDANCE:\n{l4_report.get('interaction_guidance')}")
    
    flags = l3_report.get('clinical_flags', [])
    if flags:
        print(f"⚠️  CLINICAL FLAGS: {', '.join(flags)}")
    else:
        print("✅ No immediate clinical risks detected.")
        
    print("="*40 + "\n")

if __name__ == "__main__":
    main()
