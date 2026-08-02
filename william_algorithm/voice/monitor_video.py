import argparse
import os
import logging
import subprocess
import numpy as np
from audio_pipeline.preprocess import wav_reader
from audio_pipeline.layer1 import vad
from audio_pipeline import config

# Setup logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

class VideoMonitor:
    def __init__(self, input_video, out_dir, 
                 monitor_window_sec=300,  # 5分钟一个监测窗口
                 clip_duration_sec=10,    # 每次只存 10秒
                 max_silence_sec=1200,    # 20分钟没动静就存一次心跳
                 speech_threshold=0.1,    # 窗口内 10% 的时间有语音就算活跃
                 rms_threshold=0.03):     # 平均音量阈值
        
        self.input_video = input_video
        self.out_dir = out_dir
        
        # Parameters
        self.monitor_window_sec = monitor_window_sec
        self.clip_duration_sec = clip_duration_sec
        self.max_silence_sec = max_silence_sec
        self.speech_threshold = speech_threshold
        self.rms_threshold = rms_threshold
        
        # State
        self.accumulated_silence = 0.0
        
        # Output setup
        os.makedirs(out_dir, exist_ok=True)
        self.clips_dir = os.path.join(out_dir, "clips")
        os.makedirs(self.clips_dir, exist_ok=True)

    def extract_clip(self, start_time, reason):
        """Uses ffmpeg to extract a specific clip."""
        # Convert seconds to HH-MM-SS for filename readability
        hrs = int(start_time // 3600)
        mins = int((start_time % 3600) // 60)
        secs = int(start_time % 60)
        timestamp_str = f"{hrs:02d}h{mins:02d}m{secs:02d}s"
        
        out_filename = f"event_{timestamp_str}_{reason}.mp4"
        out_path = os.path.join(self.clips_dir, out_filename)
        
        logging.info(f"💾 Saving Clip: {out_filename} (Reason: {reason})")
        
        cmd = [
            "ffmpeg",
            "-ss", str(start_time),
            "-t", str(self.clip_duration_sec),
            "-i", self.input_video,
            "-c:v", "libx264",
            "-preset", "ultrafast",
            "-c:a", "aac",
            "-y",
            "-loglevel", "error",
            out_path
        ]
        
        try:
            subprocess.run(cmd, check=True)
        except Exception as e:
            logging.error(f"FFmpeg Error: {e}")

    def run(self):
        logging.info(f"📺 Processing Video: {self.input_video}")
        
        # 1. Load Audio
        try:
            logging.info("   -> Extracting audio track (this may take a moment)...")
            audio, sr = wav_reader.read_audio(self.input_video)
            total_duration = wav_reader.get_duration(audio, sr)
            logging.info(f"   -> Audio Loaded. Duration: {total_duration/60:.1f} min")
        except Exception as e:
            logging.error(f"Failed to load audio: {e}")
            return

        # 2. Init VAD
        vad_processor = vad.VAD(sample_rate=sr)
        
        # 3. Process in Chunks (Monitor Windows)
        current_time = 0.0
        
        while current_time < total_duration:
            window_end = min(current_time + self.monitor_window_sec, total_duration)
            actual_window_duration = window_end - current_time
            
            # Extract audio for this large window
            start_sample = int(current_time * sr)
            end_sample = int(window_end * sr)
            window_audio = audio[start_sample:end_sample]
            
            # --- Analyze this Window ---
            # We want to find:
            # 1. Average stats (to decide if we save anything)
            # 2. Peak moment (to decide WHICH part to save)
            
            # Break down window into 1s sub-frames for fine-grained stats
            sub_frame_size = sr # 1 second
            
            rms_list = []
            speech_list = []
            
            # We'll also track the loudest second to use as the slice center
            max_rms = -1.0
            peak_offset_sec = 0.0 
            
            num_sub_frames = int(len(window_audio) / sub_frame_size)
            
            for i in range(num_sub_frames):
                sub = window_audio[i*sub_frame_size : (i+1)*sub_frame_size]
                
                # RMS
                curr_rms = np.sqrt(np.mean(sub**2))
                rms_list.append(curr_rms)
                
                # Track peak
                if curr_rms > max_rms:
                    max_rms = curr_rms
                    peak_offset_sec = i # The peak happened at i-th second of this window
                
                # VAD
                # (Note: VAD might be slow if window is huge, but 5 mins is ~300 calls, should be instant)
                curr_speech = vad_processor.process_window(sub)
                speech_list.append(curr_speech)

            # --- Calculate Window Stats ---
            avg_rms = np.mean(rms_list) if rms_list else 0
            avg_speech = np.mean(speech_list) if speech_list else 0
            
            logging.info(f"[{int(current_time/60)}m - {int(window_end/60)}m] "
                         f"Speech: {avg_speech*100:.1f}% | Vol: {avg_rms:.4f}")

            # --- DECISION LOGIC ---
            
            # Rule 1: Activity Detected
            if avg_speech > self.speech_threshold or avg_rms > self.rms_threshold:
                # Yes, this is an active window.
                # Find the best time to slice. We use 'peak_offset_sec' (loudest moment).
                # Center the clip around the peak, but stay within window bounds.
                
                slice_start = current_time + peak_offset_sec - (self.clip_duration_sec / 2)
                # Clamp start time
                slice_start = max(current_time, min(slice_start, window_end - self.clip_duration_sec))
                
                self.extract_clip(slice_start, "ACTIVE")
                self.accumulated_silence = 0 # Reset silence counter
                
            # Rule 2: Silence / Heartbeat
            else:
                self.accumulated_silence += actual_window_duration
                
                if self.accumulated_silence >= self.max_silence_sec:
                    # Too long without activity. Force a heartbeat slice.
                    # Just take the middle of the current window.
                    mid_point = current_time + (actual_window_duration / 2)
                    self.extract_clip(mid_point, "HEARTBEAT")
                    self.accumulated_silence = 0 # Reset

            # Move to next window
            current_time += self.monitor_window_sec

        logging.info("Done.")

def main():
    parser = argparse.ArgumentParser(description="Monitor video with long windows.")
    parser.add_argument("input_video", help="Path to input video file")
    parser.add_argument("--outdir", default="out_monitor", help="Output directory")
    
    # Defaults tailored for "Minute-level" monitoring
    parser.add_argument("--window", type=int, default=300, help="Monitor window in seconds (default: 300s = 5min)")
    parser.add_argument("--clip", type=int, default=10, help="Duration of saved clip (default: 10s)")
    parser.add_argument("--silence_limit", type=int, default=1200, help="Force save after N seconds of silence (default: 1200s = 20min)")
    
    args = parser.parse_args()
    
    monitor = VideoMonitor(
        input_video=args.input_video, 
        out_dir=args.outdir,
        monitor_window_sec=args.window,
        clip_duration_sec=args.clip,
        max_silence_sec=args.silence_limit
    )
    monitor.run()

if __name__ == "__main__":
    main()
