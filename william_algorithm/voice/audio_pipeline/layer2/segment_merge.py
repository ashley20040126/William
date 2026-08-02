from .. import config
from collections import Counter

class SegmentMerger:
    def __init__(self):
        self.current_segment = None
        self.segments = []
        
    def merge_stream(self, classified_stream):
        """
        Consumes a stream of (feature, state) tuples and produces merged segments.
        
        Args:
            classified_stream: Iterable of (feature_dict, state_str)
        
        Returns:
            List[dict]: List of segment objects.
        """
        self.segments = []
        self.current_segment = None
        
        for feature, state in classified_stream:
            self._process_step(feature, state)
            
        # Flush last segment
        if self.current_segment:
            self.segments.append(self.current_segment)
            
        return self.segments

    def _process_step(self, feature, state):
        ts = feature['ts_ms']
        
        # If no current segment, start one
        if self.current_segment is None:
            self._start_new_segment(ts, state, feature)
            return

        # Check if we should merge
        # 1. Same state? -> Merge
        if state == self.current_segment['type']:
            self._extend_segment(feature)
        
        # 2. Different state, but maybe it's a short gap in SPEECH?
        # (For MVP, we keep it simple: strict state change = new segment. 
        # Hysteresis can be added here if needed, but let's stick to strict state first for clarity)
        else:
            self.segments.append(self.current_segment)
            self._start_new_segment(ts, state, feature)

    def _start_new_segment(self, start_ts, state, feature):
        self.current_segment = {
            "type": state,
            "start_ts_ms": start_ts,
            "end_ts_ms": start_ts + 1000, # Initial duration 1s
            "duration_s": 1.0,
            "features_accumulator": [feature], # Keep raw features to aggregate later
            "emotion_counts": Counter()
        }
        self._accumulate_emotion(feature)

    def _extend_segment(self, feature):
        self.current_segment['end_ts_ms'] = feature['ts_ms'] + 1000
        self.current_segment['duration_s'] += 1.0
        self.current_segment['features_accumulator'].append(feature)
        self._accumulate_emotion(feature)

    def _accumulate_emotion(self, feature):
        # Add emotion label to counter if it exists
        emo = feature.get('emotion')
        if emo and emo.get('top_label'):
            self.current_segment['emotion_counts'][emo['top_label']] += 1
