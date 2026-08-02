from django.shortcuts import render, get_object_or_404
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
import json
import uuid

# Import our logic
from chat.models import ChatSession, ChatMessage
from chat.experts import EXPERTS_LIST, get_expert_by_id
# Note: In Django 3.1+, views can be async. But we might need 'asgiref.sync.sync_to_async' or 'async_to_sync'
# if calling async code from sync view, OR just make the view async.
# Django 4.2 supports async views properly.
from chat.services.ai_service import get_llm_response, route_intent
from asgiref.sync import async_to_sync, sync_to_async

def index(request):
    """Landing page: List of experts."""
    context = {
        'experts': EXPERTS_LIST
    }
    return render(request, 'chat/index.html', context)

def chat_page(request, session_id=None):
    """Chat interface page."""
    # If no session_id, we can generate one in client or redirect. 
    # Here we just render the page, and JS will handle session creation or reuse.
    expert_id = request.GET.get('expert_id')
    selected_expert = get_expert_by_id(expert_id) if expert_id else None
    
    context = {
        'session_id': session_id, # Might be None, JS handles it
        'selected_expert': selected_expert,
    }
    return render(request, 'chat/chat.html', context)

@csrf_exempt
def chat_api(request):
    """
    API endpoint to handle chat messages.
    Expected JSON: { "session_id": "...", "message": "...", "expert_id": "..." (opt) }
    """
    if request.method == "POST":
        try:
            data = json.loads(request.body)
            message_text = data.get('message')
            session_id = data.get('session_id')
            req_expert_id = data.get('expert_id') # User explicitly selected expert
            
            if not message_text:
                return JsonResponse({'error': 'Message required'}, status=400)

            # Get or Create Session
            if session_id:
                session, created = ChatSession.objects.get_or_create(id=session_id)
            else:
                session = ChatSession.objects.create()
                session_id = str(session.id)
            
            # Update target expert if provided (switching context)
            if req_expert_id and get_expert_by_id(req_expert_id):
                session.target_expert_id = req_expert_id
                session.save()
            
            # Save User Message
            ChatMessage.objects.create(
                session=session,
                role='user',
                content=message_text
            )
            
            # Determine which expert answers
            target_id = session.target_expert_id
            
            # AUTO-ROUTING LOGIC
            # If no target expert set, OR user specifically asked for "auto" (if we had that flag), logic here:
            if not target_id:
                # Call Router
                target_id = route_intent(message_text)
                # Note: We do NOT pin this expert to session permanently in Auto mode? 
                # Or do we? Let's say Auto mode is per-message dynamic routing.
                # So we don't save to session.target_expert_id unless user manually picked.
            
            # Call Expert Logic
            # get_llm_response is async, so we wrap it
            reply_text = async_to_sync(get_llm_response)(target_id, message_text)
            
            expert_obj = get_expert_by_id(target_id)
            expert_name = expert_obj.name if expert_obj else "Unknown"
            expert_avatar = expert_obj.avatar if expert_obj else "🤖"
            
            # Save Assistant Message
            ChatMessage.objects.create(
                session=session,
                role='assistant',
                content=reply_text,
                expert_id=target_id
            )
            
            return JsonResponse({
                'reply': reply_text,
                'expert_id': target_id,
                'expert_name': expert_name,
                'expert_avatar': expert_avatar,
                'session_id': session_id
            })

        except Exception as e:
            print(f"API Error: {e}")
            return JsonResponse({'error': str(e)}, status=500)
    
    return JsonResponse({'error': 'POST required'}, status=405)

