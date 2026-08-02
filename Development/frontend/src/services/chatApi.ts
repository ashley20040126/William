import { getJson, postForm, deleteJson, postJson } from '@/services/http';
import type { ScheduleCandidate } from '@/services/store';

type ChatAttachmentPayload = {
  id?: number;
  name: string;
  path: string;
  type: string;
  size: number;
  kind?: 'image' | 'document' | 'audio' | 'other';
  status?: 'uploaded' | 'processing' | 'ready' | 'failed';
  summary?: string;
  excerpt?: string;
  ocrText?: string;
};

export async function sendChat(
  content: string,
  name: string,
  files: File[] = [],
  sessionId?: string,
  aiChatUrl?: string,
  temporaryChat = false
): Promise<{
  reply: string;
  sessionId?: string;
  analysis?: { emotion: string; stress: number; patterns: string[] };
  userMessage?: {
    id?: number;
    role: 'user';
    content: string;
    attachments?: ChatAttachmentPayload[];
    scheduleCandidates?: ScheduleCandidate[];
    ts: string;
  };
  assistantMessage?: {
    id?: number;
    role: 'assistant';
    content: string;
    voiceId?: string;
    scheduleCandidates?: ScheduleCandidate[];
    practiceSuggestions?: Array<{
      id: string;
      rawId: number | null;
      title: string;
      description: string;
      recommendedTime: string | null;
      actionPrompt: string | null;
      status: 'pending' | 'completed';
      completedAt: string | null;
      saved?: boolean;
      suggestionDate?: string | null;
    }>;
    ts: string;
  };
}> {
  try {
    const formData = new FormData();
    formData.append('content', content);
    formData.append('sessionId', sessionId || `s_${new Date().toISOString().split('T')[0]}`);
    if (aiChatUrl) formData.append('aiChatUrl', aiChatUrl);
    if (temporaryChat) formData.append('temporaryChat', 'true');
    files.forEach((file) => formData.append('files', file));
    const result = await postForm<{
      reply: string;
      sessionId?: string;
      voiceId?: string;
      analysis?: { emotion: string; stress: number; patterns: string[] };
      userMessage?: {
        id?: number;
        role: 'user';
        content: string;
        voiceId?: string;
        attachments?: ChatAttachmentPayload[];
        scheduleCandidates?: ScheduleCandidate[];
        ts: string;
      };
      assistantMessage?: {
        id?: number;
        role: 'assistant';
        content: string;
        voiceId?: string;
        scheduleCandidates?: ScheduleCandidate[];
        practiceSuggestions?: Array<{
          id: string;
          rawId: number | null;
          title: string;
          description: string;
          recommendedTime: string | null;
          actionPrompt: string | null;
          status: 'pending' | 'completed';
          completedAt: string | null;
          saved?: boolean;
          suggestionDate?: string | null;
        }>;
        ts: string;
      };
    }>('/api/chat/message', formData);
    return result;
  } catch {
    return { reply: localReply(content, name) };
  }
}

export async function getChatHistory(limit = 50) {
  const data = await getJson<{ history: any[] }>(`/api/chat/history?limit=${limit}`);
  return data?.history || [];
}

export async function clearChatHistory() {
  return await deleteJson<{ success: boolean }>('/api/chat/history');
}

export async function syncPracticeSuggestions(
  messageId: number,
  suggestions: Array<{
    id: string;
    rawId: number | null;
    title: string;
    description: string;
    recommendedTime: string | null;
    actionPrompt: string | null;
    status: 'pending' | 'completed';
    completedAt: string | null;
    saved?: boolean;
    suggestionDate?: string | null;
  }>
) {
  return postJson<{ ok: boolean }>(`/api/chat/messages/${messageId}/practice-suggestions`, { suggestions });
}

function localReply(text: string, name: string): string {
  const lowered = text.toLowerCase();
  const rules: [RegExp, string][] = [
    [/sad|down|depressed|lonely/, `I hear the heaviness, ${name}. When did this start?`],
    [/anxious|anxiety|worried|panic/, `Anxiety is information, ${name}. Where do you feel it physically?`],
    [/angry|frustrated|irritated/, `That frustration is valid, ${name}. What boundary was crossed?`],
    [/happy|great|good|amazing/, `Worth holding onto, ${name}. What makes this feel good?`],
    [/sleep|tired|exhausted/, `Sleep is the foundation, ${name}. Walk me through last night.`],
    [/stress|pressure|burnout/, `What feels most unsustainable right now, ${name}?`],
    [/focus|distract/, `Focus problems are rarely about willpower, ${name}. When were you last locked in?`],
    [/hi|hey|hello/, `Hey ${name}. What's on your mind?`],
    [/thank/, `You don't need to thank me, ${name}. Anything else?`],
  ];

  for (const [pattern, reply] of rules) {
    if (pattern.test(lowered)) return reply;
  }

  return `Tell me more, ${name}. I want to connect this to patterns I'm seeing.`;
}
