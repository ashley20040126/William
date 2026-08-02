from django.db import models
import uuid

class ChatSession(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    # If a session is pinned to a specific expert, we categorize it here. 
    # If null, it might be an auto-routing session or a mixed session.
    target_expert_id = models.CharField(max_length=50, null=True, blank=True)

    def __str__(self):
        return f"Session {self.id} ({self.target_expert_id or 'Auto'})"

class ChatMessage(models.Model):
    ROLE_CHOICES = (
        ('user', 'User'),
        ('assistant', 'Assistant'),
    )

    session = models.ForeignKey(ChatSession, on_delete=models.CASCADE, related_name='messages')
    role = models.CharField(max_length=10, choices=ROLE_CHOICES)
    content = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)
    
    # For assistant messages, record which expert answered
    expert_id = models.CharField(max_length=50, null=True, blank=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f"{self.role}: {self.content[:30]}..."
