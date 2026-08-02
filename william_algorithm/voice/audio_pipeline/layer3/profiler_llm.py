import os
import json
import logging
from openai import OpenAI

# The system prompt ensures the LLM outputs exactly the JSON structure we want.
SYSTEM_PROMPT = """
You are an expert psychological profiler and empathetic AI companion backend.
Your task is to analyze a sequence of "audio events" passively recorded from a user.
These events contain timestamps, acoustic emotion analysis (e.g., 'hap', 'ang', 'sad', 'neu', 'exc'), 
and optional ASR transcripts.

[STRICT EVIDENCE BOUNDARY RULE]
1. If an event DOES NOT contain an ASR transcript, you MUST NOT guess or invent specific stressors (e.g., do not say "work pressure" or "family argument"). You may only describe behavioral patterns (e.g., "The user showed signs of high arousal and frustration").
2. If an event DOES contain an ASR transcript, you may extract specific facts and triggers based ONLY on what was actually said.

Based on this raw data, extract a structured "Psychological Profile".

Output your analysis strictly in JSON format matching the following structure:
{
  "status": "success",
  "narrative_summary": "A brief summary of the behavioral patterns and overall mood journey. Adhere strictly to the Evidence Boundary.",
  "stressors_and_triggers": [
    "Specific trigger 1 (ONLY if semantic evidence exists)",
    "Behavioral pattern observation (if no semantic evidence exists)"
  ],
  "extracted_facts": [
    {
      "category": "work/project",
      "fact": "The specific fact extracted (ONLY if semantic evidence exists)."
    }
  ],
  "interaction_guidance": "Instructions for the AI companion on how to approach the user next time (e.g., active_chat with empathetic tone, or passive_check_in)."
}
"""

class LLMProfiler:
    def __init__(self, model_name="gpt-4o-mini"):
        self.model_name = model_name
        self.client = None
        
        api_key = os.getenv("OPENAI_API_KEY")
        if api_key:
            self.client = OpenAI(
                api_key=api_key,
                base_url=os.getenv("OPENAI_BASE_URL")
            )
        else:
            logging.warning("OPENAI_API_KEY not found. LLM Profiling will be disabled.")

    def format_events(self, events):
        """Formats events, handling both with and without speech transcripts."""
        formatted_lines = []
        for event in events:
            summary = event.get("summary", {})
            time_sec = event.get("start_ts_ms", 0) / 1000.0
            emotion = summary.get("dominant_emotion", "unknown")
            event_type = event.get("type", "UNKNOWN")
            
            line = f"[{time_sec:.1f}s] Type: {event_type} | Emotion: {emotion.upper()}"
            
            if "transcript" in summary and summary["transcript"].strip():
                text = summary["transcript"]
                line += f" | Transcript: \"{text}\""
                
            formatted_lines.append(line)
        return "\n".join(formatted_lines)

    def analyze(self, events):
        """Calls the LLM to analyze the events and returns the parsed JSON dict."""
        if not self.client:
            return {"status": "skipped", "reason": "No API key"}

        formatted_text = self.format_events(events)
        
        if not formatted_text:
            return {"status": "skipped", "reason": "No events to analyze"}

        logging.info(f"Sending {len(formatted_text)} chars of transcript to LLM Profiler ({self.model_name})...")
        
        try:
            response = self.client.chat.completions.create(
                model=self.model_name,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": f"Here are the recorded audio events:\n\n{formatted_text}\n\nAnalyze and return the JSON."}
                ],
                response_format={ "type": "json_object" }
            )
            
            result_text = response.choices[0].message.content
            return json.loads(result_text)
            
        except Exception as e:
            logging.error(f"LLM Profiling failed: {e}")
            return {"status": "error", "reason": str(e)}
