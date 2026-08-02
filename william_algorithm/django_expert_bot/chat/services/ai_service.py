import json
import os
import asyncio
from openai import OpenAI
from chat.experts import EXPERTS_LIST, get_expert_by_id

# Import our local LightRAG integration
# Note: We use relative import or assume expert_panel_project is in python path
try:
    from expert_panel_project.lightrag_core.rag_factory import query as rag_query
except ImportError:
    # Fallback if running relative to manage.py
    from lightrag_core.rag_factory import query as rag_query

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

async def get_llm_response(expert_id: str, message: str) -> str:
    """
    Get response from a specific expert.
    Uses LightRAG for knowledge retrieval + Style Rewrite for persona.
    """
    expert = get_expert_by_id(expert_id)
    if not expert:
        return "Sorry, that expert does not exist."

    # PRE-CHECK: If storage directory is empty or missing, skip RAG
    # LightRAG requires an initialized storage to work properly.
    # We check for a key file usually present in LightRAG storage, e.g., 'kv_store_text_chunks.json' or just check if dir has files
    has_knowledge = False
    if os.path.exists(expert.storage_dir):
        # Check if directory is not empty
        if any(os.scandir(expert.storage_dir)):
            has_knowledge = True
    
    if not has_knowledge:
        print(f"⚠️ Expert '{expert.id}' has no knowledge base (empty {expert.storage_dir}). Fallback to OpenAI.")
        return await _fallback_openai_chat(expert, message)

    # Call the LightRAG query logic
    # This will (in the real version) query the vector DB and then rewrite the answer
    try:
        # Check if style file exists, otherwise pass None to skip rewrite
        style_path = expert.style_path if os.path.exists(expert.style_path) else None
        
        # We need to run the async rag_query
        # If this is called from a sync view, we might need async_to_sync or just run it here
        # For Demo simplicity (and since Django 4.2 supports async views), 
        # let's assume the view calling this is async, or we await it.
        
        answer = await rag_query(
            question=message,
            working_dir=expert.storage_dir,
            mode="mix",  # mix mode matches local + global search
            style_path=style_path
        )
        return answer
        
    except Exception as e:
        print(f"Error in RAG generation: {e}")
        # Fallback to simple OpenAI if RAG fails (or in mock mode)
        return await _fallback_openai_chat(expert, message)



async def _fallback_openai_chat(expert, message):
    """Fallback simple chat if RAG fails"""
    system_prompt = f"You are {expert.name}, a {expert.title}. {expert.description}. Answer helpfully."
    
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message}
        ]
    )
    return response.choices[0].message.content


def route_intent(user_query: str) -> str:
    """
    Analyze user query and return the best expert_id.
    """
    # Construct a routing prompt
    experts_desc = "\n".join([f"- {e.id}: {e.title} ({e.description})" for e in EXPERTS_LIST])
    
    prompt = f"""
    You are an intelligent receptionist expert router.
    Analyze the user's question and select the most suitable expert ID from the list below.
    
    Experts:
    {experts_desc}
    
    User Question: "{user_query}"
    
    Return ONLY the expert ID (e.g., 'lawyer'). If no one is suitable, return 'coder' (default).
    """
    
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1
        )
        expert_id = response.choices[0].message.content.strip().lower()
        
        # Validate id
        if get_expert_by_id(expert_id):
            return expert_id
        return "coder" # Default fallback
    except Exception as e:
        print(f"Routing error: {e}")
        return "coder"
