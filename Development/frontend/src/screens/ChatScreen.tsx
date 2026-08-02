import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { type ChatAttachment, type ChatMsg, type ScheduleCandidate, useStore } from '@/services/store';
import * as api from '@/services/api';
import { getVoiceApiErrorMessage } from '@/services/voiceApi';
import { VOICES } from '@/utils/data';
import { haptic } from '@/hooks/useWebViewBridge';
import { useStreamingSpeechInput } from '@/hooks/useStreamingSpeechInput';
import { ModelAvatar, Overlay } from '@/components/ui';
import ScheduleCandidateEditor from '@/components/ScheduleCandidateEditor';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '@/i18n/useI18n';
import { getIntlLocale, translateText } from '@/i18n/messages';

type PracticeSuggestion = NonNullable<ChatMsg['practiceSuggestions']>[number];

export default function ChatScreen() {
  const s = useStore();
  const setChatSessionId = s.setChatSessionId;
  const ambientListeningEnabled = s.ambientListeningEnabled;
  const ambientListeningSupported = s.ambientListeningSupported;
  const ambientListeningActive = s.ambientListeningActive;
  const ambientListeningError = s.ambientListeningError;
  const temporaryChatEnabled = s.temporaryChatEnabled;
  const nav = useNavigate();
  const location = useLocation();
  const { tx, locale } = useI18n();
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [showVoiceSel, setShowVoiceSel] = useState(false);
  const [showMediaPicker, setShowMediaPicker] = useState(false);
  const [showAiChatLink, setShowAiChatLink] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showVoiceCall, setShowVoiceCall] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [aiChatError, setAiChatError] = useState('');
  const [voiceCallBusy, setVoiceCallBusy] = useState(false);
  const [callTranscript, setCallTranscript] = useState('');
  const [callReply, setCallReply] = useState('');
  const [callStatusText, setCallStatusText] = useState(tx('准备开始语音通话'));
  const [callDuplexActive, setCallDuplexActive] = useState(false);
  const [callPhase, setCallPhase] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [aiChatUrl, setAiChatUrl] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [scheduleBusyId, setScheduleBusyId] = useState<number | null>(null);
  const [editingScheduleTarget, setEditingScheduleTarget] = useState<{ messageTs: string; candidate: ScheduleCandidate } | null>(null);
  const [practiceBusyId, setPracticeBusyId] = useState<string | null>(null);

  const endRef = useRef<HTMLDivElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const speechDraftBaseRef = useRef('');
  const callSilenceTimerRef = useRef<number | null>(null);
  const callSendingRef = useRef(false);
  const callSpeakingTokenRef = useRef(0);
  const callLifecycleTokenRef = useRef(0);
  const speechCancelRef = useRef<() => void>(() => {});
  const callCancelRef = useRef<() => void>(() => {});
  const showVoiceCallRef = useRef(false);
  const lastSpokenReplyRef = useRef('');
  const lastSpokenFinishedAtRef = useRef(0);
  const ttsAudioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAudioUrlRef = useRef<string>('');
  const appLanguage = s.language || 'zh-CN';
  const consumedAssistantPromptRef = useRef<string>('');

  const speechInput = useStreamingSpeechInput(appLanguage);
  const callInput = useStreamingSpeechInput(appLanguage);
  const v = VOICES.find((voice) => voice.id === s.voice) || VOICES[0];
  const callRecordingActive = callPhase === 'listening' && callInput.isListening;
  const speechDraftActive = speechInput.isListening || speechInput.isFinalizing;

  useEffect(() => {
    if (!s.chatSessionId) {
      setChatSessionId(createChatSessionId());
    }
  }, [s.chatSessionId, setChatSessionId]);

  useEffect(() => {
    showVoiceCallRef.current = showVoiceCall;
  }, [showVoiceCall]);

  useEffect(() => {
    speechCancelRef.current = speechInput.cancel;
    callCancelRef.current = callInput.cancel;
  }, [callInput.cancel, speechInput.cancel]);

  useEffect(() => () => {
    callLifecycleTokenRef.current += 1;
    speechCancelRef.current();
    callCancelRef.current();
    if (callSilenceTimerRef.current) {
      window.clearTimeout(callSilenceTimerRef.current);
    }
    if (ttsAudioRef.current) {
      ttsAudioRef.current.pause();
      ttsAudioRef.current = null;
    }
    if (ttsAudioUrlRef.current) {
      URL.revokeObjectURL(ttsAudioUrlRef.current);
      ttsAudioUrlRef.current = '';
    }
  }, []);

  useEffect(() => {
    if (s.token) {
      api.getChatHistory(30).then((history) => {
        if (history) {
          const transientMessages = useStore.getState().chat.filter((message) => Boolean(message.clientId));
          s.set({ chat: mergeHistoryWithTransientMessages(history, transientMessages) });
        }
      });
    }
  }, [s.token]);

  useEffect(() => {
    const navState = location.state as { assistantPrompt?: string; nonce?: number; source?: string } | null;
    const prompt = typeof navState?.assistantPrompt === 'string' ? navState.assistantPrompt.trim() : '';
    const promptKey = `${navState?.nonce || 'no-nonce'}:${prompt}`;
    if (!prompt || consumedAssistantPromptRef.current === promptKey) return;

    consumedAssistantPromptRef.current = promptKey;
    setText(prompt);
    nav(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, nav]);

  useEffect(() => {
    if (!speechDraftActive && !speechInput.transcript) return;
    const draft = mergeSpeechDraft(speechDraftBaseRef.current, speechInput.transcript, '');
    setText(draft);
  }, [speechDraftActive, speechInput.transcript]);

  useEffect(() => {
    if (!showVoiceCall || callPhase !== 'listening') return;
    setCallTranscript(callInput.transcript);
  }, [callInput.transcript, callPhase, showVoiceCall]);

  useEffect(() => {
    if (!showVoiceCall || callPhase !== 'listening' || !callDuplexActive) return;
    if (!callInput.lastActivityAt) return;
    scheduleCallSilenceFinalize();
  }, [callDuplexActive, callInput.lastActivityAt, callPhase, showVoiceCall]);

  useEffect(() => {
    if (showVoiceCall && callInput.error && !voiceCallBusy) {
      setCallPhase('idle');
      setCallStatusText(tx('语音识别失败，请重试'));
    }
  }, [callInput.error, showVoiceCall, tx, voiceCallBusy]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 60);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [s.chat.length, typing]);

  async function sendMessage(messageText: string, files: File[] = []) {
    const msg = messageText.trim();
    if (!msg && files.length === 0) return;

    if (text.trim() === msg && attachedFiles.length === files.length) {
      setText('');
      setAttachedFiles([]);
    }
    haptic('light');

    const currentFiles = [...files];
    const localContent = msg || (currentFiles.length > 0 ? tx('Shared {count} file(s)', { count: currentFiles.length }) : '');
    const localTs = new Date().toISOString();
    const clientId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    s.addChat({
      clientId,
      role: 'user',
      content: localContent,
      ts: localTs,
      attachments: buildPendingAttachments(currentFiles),
    });
    s.addXP(3);
    setTyping(true);

    try {
      const data = await api.sendChat(msg, s.name || 'there', currentFiles, ensureChatSessionId(), undefined, temporaryChatEnabled);
      setTyping(false);
      if (data?.sessionId) {
        s.setChatSessionId(data.sessionId);
      }
      if (data?.userMessage) {
        s.replaceChat(clientId, data.userMessage);
      } else if (currentFiles.length > 0) {
        s.replaceChat(clientId, {
          clientId,
          role: 'user',
          content: localContent,
          ts: localTs,
          attachments: buildPendingAttachments(currentFiles).map((attachment) => ({ ...attachment, status: 'failed' })),
        });
      }
      s.addChat(data?.assistantMessage || { role: 'assistant', content: data.reply, ts: new Date().toISOString(), voiceId: s.voice });
    } catch {
      setTyping(false);
      s.replaceChat(clientId, {
        clientId,
        role: 'user',
        content: localContent,
        ts: localTs,
        attachments: buildPendingAttachments(currentFiles).map((attachment) => ({ ...attachment, status: 'failed' })),
      });
      s.addChat({
        role: 'assistant',
        content: tx("I'm here, {name}. What's on your mind?", { name: s.name || tx('there') }),
        ts: new Date().toISOString(),
        voiceId: s.voice,
      });
    }
  }

  async function send() {
    await sendMessage(text, attachedFiles);
  }

  async function handleScheduleCandidateAction(messageTs: string, candidateId: number, action: 'confirm' | 'dismiss') {
    setScheduleBusyId(candidateId);
    const next = action === 'confirm'
      ? await api.confirmScheduleCandidate(candidateId)
      : await api.dismissScheduleCandidate(candidateId);
    setScheduleBusyId(null);
    if (!next) return;

    s.set({
      chat: s.chat.map((message) => {
        if (message.ts !== messageTs) return message;
        return {
          ...message,
          scheduleCandidates: (message.scheduleCandidates || []).map((candidate) =>
            candidate.id === candidateId ? next : candidate
          ),
        };
      }),
    });
    haptic(action === 'confirm' ? 'medium' : 'light');
  }

  async function handleScheduleCandidateEdit(payload: {
    title: string;
    dateText: string;
    location: string;
    participants: string[];
  }) {
    if (!editingScheduleTarget) return;
    const candidateId = editingScheduleTarget.candidate.id;
    setScheduleBusyId(candidateId);
    const next = await api.editScheduleCandidate(candidateId, payload);
    setScheduleBusyId(null);
    if (!next) return;

    s.set({
      chat: s.chat.map((message) => {
        if (message.ts !== editingScheduleTarget.messageTs) return message;
        return {
          ...message,
          scheduleCandidates: (message.scheduleCandidates || []).map((candidate) =>
            candidate.id === candidateId ? next : candidate
          ),
        };
      }),
    });
    setEditingScheduleTarget(null);
    haptic('light');
  }

  async function handlePracticeSuggestionToggle(messageTs: string, todoId: string, completed: boolean) {
    setPracticeBusyId(todoId);
    const parentMessage = s.chat.find((message) => message.ts === messageTs);
    const target = parentMessage?.practiceSuggestions?.find((item) => item.id === todoId);
    if (!target) {
      setPracticeBusyId(null);
      return;
    }

    if (!target.saved) {
      // Optimistic update: immediately show grayed/saved state for instant feedback
      const optimisticChat: ChatMsg[] = s.chat.map((message) => {
        if (message.ts !== messageTs) return message;
        return {
          ...message,
          practiceSuggestions: (message.practiceSuggestions || []).map((item) =>
            item.id === todoId ? { ...item, saved: true } : item
          ),
        };
      });
      s.set({ chat: optimisticChat });

      const confirmed = await api.confirmAssistantPracticeSuggestion({
        title: target.title,
        description: target.description,
        recommendedTime: target.recommendedTime,
        actionPrompt: target.actionPrompt,
        suggestionDate: target.suggestionDate,
      });
      setPracticeBusyId(null);
      haptic('light');
      if (!confirmed) return;
      const normalizedConfirmed: NonNullable<ChatMsg['practiceSuggestions']>[number] = {
        id: String((confirmed as any).id || target.id),
        rawId: typeof (confirmed as any).rawId === 'number' ? (confirmed as any).rawId : target.rawId,
        title: String((confirmed as any).title || target.title),
        description: String((confirmed as any).description || target.description),
        recommendedTime: typeof (confirmed as any).recommendedTime === 'string' || (confirmed as any).recommendedTime === null
          ? (confirmed as any).recommendedTime
          : target.recommendedTime,
        actionPrompt: typeof (confirmed as any).actionPrompt === 'string' || (confirmed as any).actionPrompt === null
          ? (confirmed as any).actionPrompt
          : target.actionPrompt,
        status: (confirmed as any).status === 'completed' ? 'completed' : 'pending',
        completedAt: (confirmed as any).completedAt ?? null,
        saved: true,
        suggestionDate: typeof (confirmed as any).suggestionDate === 'string' || (confirmed as any).suggestionDate === null
          ? (confirmed as any).suggestionDate
          : target.suggestionDate,
      };

      const nextChat: ChatMsg[] = s.chat.map((message) => {
        if (message.ts !== messageTs) return message;
        const nextSuggestions: PracticeSuggestion[] = (message.practiceSuggestions || []).map((item) =>
          item.id === todoId
            ? normalizedConfirmed
            : item
        );
        return {
          ...message,
          practiceSuggestions: nextSuggestions,
        };
      });
      s.set({ chat: nextChat });
      const nextMessage = nextChat.find((message) => message.ts === messageTs);
      if (parentMessage?.id && nextMessage?.practiceSuggestions) {
        await api.syncPracticeSuggestions(parentMessage.id, nextMessage.practiceSuggestions);
      }
      return;
    }

    const next = await api.logPractice(todoId, completed);
    setPracticeBusyId(null);
    if (!next) return;

    const nextChat: ChatMsg[] = s.chat.map((message) => {
      if (message.ts !== messageTs) return message;
      const nextSuggestions: PracticeSuggestion[] = (message.practiceSuggestions || []).map((item) =>
        item.id === todoId
          ? { ...item, status: completed ? 'completed' as const : 'pending' as const, completedAt: completed ? new Date().toISOString() : null, saved: true }
          : item
      );
      return {
        ...message,
        practiceSuggestions: nextSuggestions,
      };
    });
    s.set({ chat: nextChat });
    const nextMessage = nextChat.find((message) => message.ts === messageTs);
    if (parentMessage?.id && nextMessage?.practiceSuggestions) {
      await api.syncPracticeSuggestions(parentMessage.id, nextMessage.practiceSuggestions);
    }
    haptic('light');
  }

  async function dismissPracticeSuggestion(messageTs: string, todoId: string) {
    const parentMessage = s.chat.find((message) => message.ts === messageTs);
    const nextChat: ChatMsg[] = s.chat.map((message) => {
      if (message.ts !== messageTs) return message;
      const nextSuggestions: PracticeSuggestion[] = (message.practiceSuggestions || []).filter((item) => item.id !== todoId);
      return {
        ...message,
        practiceSuggestions: nextSuggestions,
      };
    });
    s.set({ chat: nextChat });
    const nextMessage = nextChat.find((message) => message.ts === messageTs);
    if (parentMessage?.id && nextMessage?.practiceSuggestions) {
      await api.syncPracticeSuggestions(parentMessage.id, nextMessage.practiceSuggestions);
    }
    haptic('light');
  }

  async function sendAiChatLink() {
    const rawUrl = aiChatUrl.trim();
    if (!rawUrl) {
      setAiChatError(tx('请先粘贴一个公开可访问的 AI Chat 链接。'));
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl);
    } catch {
      setAiChatError(tx('链接格式不正确。'));
      return;
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      setAiChatError(tx('只支持 http/https 链接。'));
      return;
    }

    const clientId = `link_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const localTs = new Date().toISOString();
    s.addChat({
      clientId,
      role: 'user',
      content: tx('Shared AI Chat link'),
      ts: localTs,
      attachments: [buildPendingLinkAttachment(parsedUrl.toString())],
    });
    setShowAiChatLink(false);
    setAiChatError('');
    setAiChatUrl('');
    setTyping(true);
    haptic('light');

    try {
      const data = await api.sendChat('', s.name || 'there', [], ensureChatSessionId(), parsedUrl.toString(), temporaryChatEnabled);
      setTyping(false);
      if (data?.sessionId) {
        s.setChatSessionId(data.sessionId);
      }
      if (data?.userMessage) {
        s.replaceChat(clientId, data.userMessage);
      }
      s.addChat(data?.assistantMessage || { role: 'assistant', content: data.reply, ts: new Date().toISOString(), voiceId: s.voice });
    } catch {
      setTyping(false);
      s.replaceChat(clientId, {
        clientId,
        role: 'user',
        content: tx('Shared AI Chat link'),
        ts: localTs,
        attachments: [{ ...buildPendingLinkAttachment(parsedUrl.toString()), status: 'failed', summary: tx('链接导入失败，请确认它是公开可访问的页面。') }],
      });
      s.addChat({
        role: 'assistant',
        content: tx('这个链接我暂时没有成功导入。你可以确认它是否是公开分享页，或者把关键内容作为文件/截图发给我。'),
        ts: new Date().toISOString(),
        voiceId: s.voice,
      });
    }
  }

  function handleKey(event: React.KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      send();
    }
  }

  function ensureChatSessionId() {
    if (s.chatSessionId) return s.chatSessionId;
    const nextSessionId = createChatSessionId();
    setChatSessionId(nextSessionId);
    return nextSessionId;
  }

  function startFreshChat(nextTemporaryChat = temporaryChatEnabled) {
    speechInput.cancel();
    callInput.cancel();
    setText('');
    setAttachedFiles([]);
    setShowMediaPicker(false);
    setShowAiChatLink(false);
    setAiChatError('');
    setVoiceError('');
    setTyping(false);
    setShowHistory(false);
    s.clearChat();
    s.resetChatSession();
    s.set({ temporaryChatEnabled: nextTemporaryChat });
    s.setChatSessionId(createChatSessionId());
  }

  function scheduleCallSilenceFinalize(delayMs = 1200) {
    if (callSilenceTimerRef.current) {
      window.clearTimeout(callSilenceTimerRef.current);
    }
    callSilenceTimerRef.current = window.setTimeout(() => {
      finalizeVoiceCallTurn('auto');
    }, delayMs);
  }

  async function startStreamingVoiceCallListening() {
    const lifecycleToken = callLifecycleTokenRef.current;
    if (!showVoiceCallRef.current || callSendingRef.current) return false;
    setVoiceError('');
    callInput.cancel();
    setCallReply('');
    setCallTranscript('');
    setCallPhase('listening');
    setCallStatusText(tx('William 正在听你说…停顿后会自动发送'));
    const started = await callInput.start();
    if (callLifecycleTokenRef.current !== lifecycleToken || !showVoiceCallRef.current) {
      callInput.cancel();
      return false;
    }
    if (!started) {
      setCallPhase('idle');
      setCallStatusText(tx('无法开始录音'));
      return false;
    }
    return true;
  }

  async function speakCallReplyAndResume(reply: string) {
    const token = ++callSpeakingTokenRef.current;
    const lifecycleToken = callLifecycleTokenRef.current;
    setCallPhase('speaking');
    setCallStatusText(tx('William 正在回应你'));
    if (!reply.trim()) {
      if (callDuplexActive && showVoiceCallRef.current && token === callSpeakingTokenRef.current && lifecycleToken === callLifecycleTokenRef.current) {
        await pause(450);
        await startStreamingVoiceCallListening();
      }
      return;
    }
    await playTtsText(reply, lifecycleToken);

    if (callDuplexActive && showVoiceCallRef.current && token === callSpeakingTokenRef.current && lifecycleToken === callLifecycleTokenRef.current) {
      await pause(450);
      await startStreamingVoiceCallListening();
    }
  }

  async function finalizeVoiceCallTurn(reason: 'manual' | 'auto' = 'manual') {
    const lifecycleToken = callLifecycleTokenRef.current;
    if (callSendingRef.current || callPhase !== 'listening') return;
    callSendingRef.current = true;
    if (callSilenceTimerRef.current) {
      window.clearTimeout(callSilenceTimerRef.current);
      callSilenceTimerRef.current = null;
    }
    setVoiceError('');
    setVoiceCallBusy(true);
    setCallPhase('thinking');
    setCallStatusText(reason === 'auto' ? tx('William 正在理解你刚刚的话…') : tx('正在转写并思考…'));

    const capture = await callInput.stop();
    let finalTranscript = String(capture?.text || '').trim();

    if (callLifecycleTokenRef.current !== lifecycleToken || !showVoiceCallRef.current) {
      setVoiceCallBusy(false);
      callSendingRef.current = false;
      return;
    }
    if (capture?.usedPreviewFallback) {
      setVoiceError(tx('最终校正失败，已使用实时转写结果继续本轮通话。'));
    }
    finalTranscript = finalTranscript.trim();
    if (shouldSuppressEchoTranscript(finalTranscript, lastSpokenReplyRef.current, lastSpokenFinishedAtRef.current)) {
      setVoiceCallBusy(false);
      setCallPhase('idle');
      setCallStatusText(tx('已忽略系统播报回声，继续听你说…'));
      setVoiceError('');
      callSendingRef.current = false;
      if (callDuplexActive && showVoiceCallRef.current && lifecycleToken === callLifecycleTokenRef.current) {
        await startStreamingVoiceCallListening();
      }
      return;
    }
    if (!finalTranscript) {
      setVoiceCallBusy(false);
      setCallPhase('idle');
      setCallStatusText(tx('没有识别到有效语音'));
      setVoiceError(
        capture?.finalTranscribeError
          ? getVoiceApiErrorMessage(capture.finalTranscribeError, 'speech-input', appLanguage)
          : tx('没有识别到有效语音，请再试一次。')
      );
      callSendingRef.current = false;
      if (callDuplexActive && showVoiceCallRef.current && lifecycleToken === callLifecycleTokenRef.current) {
        await startStreamingVoiceCallListening();
      }
      return;
    }

    setCallTranscript(finalTranscript);
    const result = await api.sendVoiceTurnText(finalTranscript, ensureChatSessionId(), temporaryChatEnabled);
    if (callLifecycleTokenRef.current !== lifecycleToken || !showVoiceCallRef.current) {
      setVoiceCallBusy(false);
      callSendingRef.current = false;
      return;
    }
    if (!result.ok) {
      setVoiceCallBusy(false);
      setCallPhase('idle');
      setCallStatusText(tx('语音通话失败，请重试'));
      setVoiceError(getVoiceApiErrorMessage(result.error, 'voice-call', appLanguage));
      callSendingRef.current = false;
      return;
    }
    if (!result.data.transcript || !result.data.reply) {
      setVoiceCallBusy(false);
      setCallPhase('idle');
      setCallStatusText(tx('语音通话失败，请重试'));
      setVoiceError(tx('语音通话返回了空结果，请重试。'));
      callSendingRef.current = false;
      return;
    }

    if (result.data.sessionId) {
      s.setChatSessionId(result.data.sessionId);
    }
    setCallTranscript(result.data.transcript);
    setCallReply(result.data.reply);
    s.addChat({ role: 'user', content: result.data.transcript, ts: new Date().toISOString() });
    s.addChat({ role: 'assistant', content: result.data.reply, ts: new Date().toISOString(), voiceId: s.voice });
    setVoiceCallBusy(false);
    callSendingRef.current = false;
    haptic('light');
    await speakCallReplyAndResume(result.data.reply);
  }

  async function openSpeechInput() {
    if (voiceCallBusy || speechInput.isListening || callInput.isListening || speechInput.isFinalizing || callInput.isFinalizing) return;
    if (ambientListeningEnabled) {
      s.setAmbientListeningEnabled(false);
    }
    setVoiceError('');
    speechInput.cancel();
    speechDraftBaseRef.current = text;
    haptic('medium');
    const started = await speechInput.start();
    if (!started) {
      setVoiceError(speechInput.error || tx('语音识别启动失败，请检查麦克风权限。'));
    }
  }

  async function stopSpeechInput() {
    setVoiceError('');
    const capture = await speechInput.stop();
    const finalText = String(capture?.text || '').trim();
    if (!finalText) {
      setVoiceError(
        capture?.finalTranscribeError
          ? getVoiceApiErrorMessage(capture.finalTranscribeError, 'speech-input', appLanguage)
          : tx('语音转写失败，请再试一次。')
      );
    } else {
      const merged = mergeSpeechDraft(speechDraftBaseRef.current, finalText, '');
      setText(merged);
      if (capture?.usedPreviewFallback) {
        setVoiceError(tx('最终校正失败，已保留实时转写结果。'));
      }
    }
    haptic('light');
  }

  function cancelSpeechInput() {
    speechInput.cancel();
    setText(speechDraftBaseRef.current);
    setVoiceError('');
  }

  async function toggleSpeechComposer() {
    if (speechInput.isListening) {
      await stopSpeechInput();
      return;
    }
    if (speechInput.isFinalizing) {
      return;
    }
    await openSpeechInput();
  }

  async function openVoiceCall() {
    if (ambientListeningEnabled) {
      s.setAmbientListeningEnabled(false);
    }
    callLifecycleTokenRef.current += 1;
    showVoiceCallRef.current = true;
    setShowVoiceCall(true);
    setVoiceError('');
    setCallTranscript('');
    setCallReply('');
    setCallStatusText(tx('准备开始语音通话'));
    setCallDuplexActive(true);
    setCallPhase('idle');
    callInput.cancel();
    stopSpeaking();
    haptic('medium');
    await pause(50);
    if (callLifecycleTokenRef.current && showVoiceCallRef.current) {
      const started = await startStreamingVoiceCallListening();
      if (!started) {
        setCallDuplexActive(false);
        setCallStatusText(tx('无法开始语音通话'));
        setVoiceError(callInput.error || tx('语音识别启动失败，请检查麦克风权限。'));
      }
    }
  }

  function toggleAmbientListening() {
    if (!ambientListeningSupported && !ambientListeningEnabled) {
      setVoiceError(tx('当前浏览器不支持后台监听。'));
      return;
    }
    if (showVoiceCall || speechInput.isListening || callInput.isListening || speechInput.isFinalizing || callInput.isFinalizing) {
      setVoiceError(tx('请先结束当前语音输入或通话，再启动后台监听。'));
      return;
    }
    const nextEnabled = !ambientListeningEnabled;
    s.setAmbientListeningEnabled(nextEnabled);
    if (!nextEnabled) {
      s.clearAmbientListeningTranscript();
    }
    setShowMediaPicker(false);
    haptic('medium');
  }

  async function startVoiceCallTurn() {
    if (callPhase === 'speaking') {
      callSpeakingTokenRef.current += 1;
      stopSpeaking();
      await startStreamingVoiceCallListening();
      haptic('medium');
      return;
    }

    if (callPhase === 'thinking' || callSendingRef.current) return;

    if (!callDuplexActive) {
      setCallDuplexActive(true);
      const started = await startStreamingVoiceCallListening();
      if (started) haptic('medium');
      return;
    }

    if (callPhase === 'listening') {
      await finalizeVoiceCallTurn('manual');
    } else {
      const started = await startStreamingVoiceCallListening();
      if (started) haptic('medium');
    }
  }

  async function stopVoiceCallTurn() {
    await finalizeVoiceCallTurn('manual');
  }

  function endVoiceCall() {
    callLifecycleTokenRef.current += 1;
    showVoiceCallRef.current = false;
    setCallDuplexActive(false);
    setCallPhase('idle');
    callSendingRef.current = false;
    callSpeakingTokenRef.current += 1;
    callInput.cancel();
    stopSpeaking();
    setShowVoiceCall(false);
    setVoiceCallBusy(false);
    setVoiceError('');
    setCallTranscript('');
    setCallReply('');
    setCallStatusText(tx('准备开始语音通话'));
  }

  async function clearHistory() {
    if (temporaryChatEnabled) {
      startFreshChat(true);
      return;
    }
    if (window.confirm(tx('Clear conversation history?'))) {
      haptic('medium');
      // Synchronize with backend
      await api.clearChatHistory();
      // Clear local state
      s.clearChat();
      s.resetChatSession();
      s.setChatSessionId(createChatSessionId());
    }
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (files.length > 0) {
      setAttachedFiles((prev) => [...prev, ...files].slice(0, 5));
      setShowMediaPicker(false);
      haptic('light');
    }
    event.target.value = '';
  }

  async function playTtsText(text: string, lifecycleToken?: number) {
    const normalizedText = text.trim();
    if (!normalizedText) return;
    stopSpeaking();

    const ttsResult = await api.synthesizeVoice(normalizedText, appLanguage);
    if ((lifecycleToken != null && lifecycleToken !== callLifecycleTokenRef.current) || !showVoiceCallRef.current) {
      return;
    }
    if (ttsResult.ok && ttsResult.data.audioBlob) {
      const objectUrl = URL.createObjectURL(ttsResult.data.audioBlob);
      ttsAudioUrlRef.current = objectUrl;
      const audio = new Audio(objectUrl);
      ttsAudioRef.current = audio;
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        void audio.play().catch(() => resolve());
      });
      if ((lifecycleToken != null && lifecycleToken !== callLifecycleTokenRef.current) || !showVoiceCallRef.current) {
        stopSpeaking();
        return;
      }
      lastSpokenReplyRef.current = normalizedText;
      lastSpokenFinishedAtRef.current = Date.now();
      if (ttsAudioUrlRef.current) {
        URL.revokeObjectURL(ttsAudioUrlRef.current);
        ttsAudioUrlRef.current = '';
      }
      ttsAudioRef.current = null;
      return;
    }
    if (!ttsResult.ok) {
      console.warn('[ChatScreen] TTS failed, falling back to speechSynthesis:', ttsResult.error);
    }

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(normalizedText);
      utterance.lang = appLanguage;
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve();
      window.speechSynthesis.speak(utterance);
    });
    if ((lifecycleToken != null && lifecycleToken !== callLifecycleTokenRef.current) || !showVoiceCallRef.current) {
      stopSpeaking();
      return;
    }
    lastSpokenReplyRef.current = normalizedText;
    lastSpokenFinishedAtRef.current = Date.now();
  }

  function stopSpeaking() {
    ttsAudioRef.current?.pause();
    ttsAudioRef.current = null;
    if (ttsAudioUrlRef.current) {
      URL.revokeObjectURL(ttsAudioUrlRef.current);
      ttsAudioUrlRef.current = '';
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }

  return (
    <div className="h-full flex flex-col bg-[#F5F3EE]">
      <div
        className="flex-shrink-0 px-4 py-2 border-b border-[rgba(0,0,0,0.07)]"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 10px), 10px)' }}
      >
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowVoiceSel(true)}
            className="flex-1 bg-white border-[1.5px] border-[rgba(100,90,160,0.12)] rounded-full py-2 px-4 flex items-center gap-2 shadow-[0_1px_6px_rgba(0,0,0,0.05)] cursor-pointer"
          >
            <ModelAvatar voice={v} size="pill" rounded="md" />
            <span className="flex-1 text-left text-sm font-semibold text-ink truncate">{tx(v.name)}</span>
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
              <path d="M1 1l4 4 4-4" stroke="#1C1830" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>

          <button
            onClick={openVoiceCall}
            className="w-[38px] h-[38px] rounded-full bg-white border border-[rgba(0,0,0,0.07)] flex items-center justify-center text-lg cursor-pointer flex-shrink-0"
            title={tx('Voice Call')}
          >
            📞
          </button>
          <button
            onClick={() => startFreshChat(!temporaryChatEnabled)}
            className={clsx(
              'w-[38px] h-[38px] rounded-full border flex items-center justify-center text-sm cursor-pointer flex-shrink-0',
              temporaryChatEnabled
                ? 'bg-ink text-white border-ink'
                : 'bg-white border-[rgba(0,0,0,0.07)] text-ink-3'
            )}
            title={tx('Temporary chat')}
          >
            ◌
          </button>
          <button
            onClick={clearHistory}
            className="w-[38px] h-[38px] rounded-full bg-white border border-[rgba(0,0,0,0.07)] flex items-center justify-center text-sm cursor-pointer flex-shrink-0"
            title={tx('New Chat')}
          >
            ✦
          </button>
          <button
            onClick={() => setShowHistory(true)}
            className="w-[38px] h-[38px] rounded-full bg-white border border-[rgba(0,0,0,0.07)] flex items-center justify-center text-lg cursor-pointer flex-shrink-0"
            title={tx('History')}
          >
            🕐
          </button>
        </div>
        {temporaryChatEnabled && (
          <div className="mt-2 rounded-2xl bg-[rgba(28,24,48,0.92)] text-white px-3 py-2">
            <p className="text-[11px] font-bold uppercase tracking-widest text-white/70">{tx('Temporary chat')}</p>
            <p className="text-[12px] leading-relaxed text-white/88 mt-0.5">
              {tx('This chat will not use or create saved memories, and it will not appear in conversation history.')}
            </p>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto scroll-area px-4 py-4 space-y-4 relative">
        {s.chat.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center pointer-events-none">
            <motion.div
              animate={{ scale: [1, 1.1, 1], opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
              className="w-[90px] h-[90px] rounded-full bg-rose/10 flex items-center justify-center mb-4.5 pointer-events-auto cursor-pointer"
              onClick={openVoiceCall}
            >
              <div className="w-[66px] h-[66px] rounded-full bg-rose flex items-center justify-center text-[28px] shadow-[0_4px_22px_rgba(196,82,122,0.45)]">
                🎙️
              </div>
            </motion.div>
            <p className="text-heading text-xl text-ink/30 mb-1.5">{tx('Speak with William')}</p>
            <p className="text-xs text-ink/20 leading-relaxed">{tx('Voice first — or type below')}</p>
          </div>
        )}

        {s.chat.map((message, index) => (message.role === 'user' ? (
          <div key={`${message.ts}-${index}`} className="flex flex-col items-end animate-fade-up">
            <div className="bg-ink text-bg rounded-[20px] rounded-br-[5px] max-w-[84%] px-4 py-3 shadow-sm">
              <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{message.content}</p>
              {message.attachments && message.attachments.length > 0 && (
                <div className="mt-2 flex flex-col gap-2 border-t border-white/10 pt-2">
                  {message.attachments.map((attachment, attachmentIndex) => (
                    <AttachmentCard key={attachment.id || attachmentIndex} attachment={attachment} tone="dark" />
                  ))}
                </div>
              )}
            </div>
            {message.scheduleCandidates && message.scheduleCandidates.length > 0 && (
              <div className="mt-2 w-full max-w-[84%] flex flex-col items-end gap-2">
                {message.scheduleCandidates
                  .filter((candidate) => candidate.status !== 'dismissed')
                  .map((candidate) => (
                    <ScheduleCandidateCard
                      key={candidate.id}
                      candidate={candidate}
                      busy={scheduleBusyId === candidate.id}
                      onConfirm={() => handleScheduleCandidateAction(message.ts, candidate.id, 'confirm')}
                      onDismiss={() => handleScheduleCandidateAction(message.ts, candidate.id, 'dismiss')}
                      onEdit={() => setEditingScheduleTarget({ messageTs: message.ts, candidate })}
                    />
                  ))}
              </div>
            )}
            <span className="text-[9px] text-ink-4 mt-1 px-1">
              {new Date(message.ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        ) : (
          <div key={`${message.ts}-${index}`} className="flex gap-2 items-end animate-fade-up">
            <ModelAvatar voice={resolveVoiceForMessage(message, v)} size="sm" className="flex-shrink-0" />
            <div className="flex flex-col">
              <div className="bg-white border border-[rgba(80,70,160,0.1)] rounded-[20px] rounded-bl-[5px] max-w-[84%] px-4 py-3 shadow-sm">
                <p className="text-[15px] text-ink leading-relaxed whitespace-pre-wrap">{message.content}</p>
              </div>
              {message.scheduleCandidates && message.scheduleCandidates.length > 0 && (
                <div className="mt-2 w-full max-w-[84%] flex flex-col gap-2">
                  {message.scheduleCandidates
                    .filter((candidate) => candidate.status !== 'dismissed')
                    .map((candidate) => (
                      <ScheduleCandidateCard
                        key={candidate.id}
                        candidate={candidate}
                        busy={scheduleBusyId === candidate.id}
                        onConfirm={() => handleScheduleCandidateAction(message.ts, candidate.id, 'confirm')}
                        onDismiss={() => handleScheduleCandidateAction(message.ts, candidate.id, 'dismiss')}
                        onEdit={() => setEditingScheduleTarget({ messageTs: message.ts, candidate })}
                      />
                    ))}
                </div>
              )}
              {message.practiceSuggestions && message.practiceSuggestions.length > 0 && (
                <div className="mt-2 w-full max-w-[84%] flex flex-col gap-2">
                  {message.practiceSuggestions.map((item) => (
                    <AssistantPracticeCard
                      key={item.id}
                      item={item}
                      busy={practiceBusyId === item.id}
                      onToggle={(completed) => handlePracticeSuggestionToggle(message.ts, item.id, completed)}
                      onDismiss={() => dismissPracticeSuggestion(message.ts, item.id)}
                    />
                  ))}
                </div>
              )}
              <span className="text-[9px] text-ink-4 mt-1 px-1">
                {new Date(message.ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </div>
        )))}

        {typing && (
          <div className="flex gap-2 items-end">
            <ModelAvatar voice={v} size="sm" className="flex-shrink-0" />
            <div className="bg-white border border-[rgba(80,70,160,0.1)] rounded-[20px] rounded-bl-[5px] px-4 py-3.5 flex gap-1.5 shadow-sm">
              {[0, 1, 2].map((index) => <div key={index} className="w-1.5 h-1.5 rounded-full bg-ink-3 typing-dot" />)}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div
        className="flex-shrink-0 bg-[#F5F3EE] border-t border-[rgba(0,0,0,0.07)] p-3 space-y-2"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 12px), 12px)' }}
      >
        {attachedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2 pb-1">
            {attachedFiles.map((file, index) => (
              <div key={`${file.name}-${index}`} className="bg-white border border-ink/10 rounded-xl px-2.5 py-2 flex items-center gap-2 max-w-[220px]">
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-bg-2 flex items-center justify-center text-lg flex-shrink-0">
                  {file.type.startsWith('image/') ? (
                    <span>🖼️</span>
                  ) : (
                    <span>{file.type.includes('pdf') ? '📄' : '📎'}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-ink truncate">{file.name}</p>
                  <p className="text-[10px] text-ink-4">{formatBytes(file.size)}</p>
                </div>
                <button onClick={() => setAttachedFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index))} className="text-rose text-xs">✕</button>
              </div>
            ))}
          </div>
        )}

        {showMediaPicker && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-2 pb-1">
            <div className="flex gap-2">
              <button onClick={() => photoInputRef.current?.click()} className="flex-1 bg-white border-[1.5px] border-[rgba(80,70,160,0.1)] rounded-2xl py-2.5 flex flex-col items-center gap-1 cursor-pointer">
                <span className="text-2xl">📷</span>
                <span className="text-[10px] font-bold text-ink">{tx('Photo')}</span>
              </button>
              <button onClick={() => { setShowAiChatLink(true); setShowMediaPicker(false); }} className="flex-1 bg-white border-[1.5px] border-[rgba(80,70,160,0.1)] rounded-2xl py-2.5 flex flex-col items-center gap-1 cursor-pointer">
                <span className="text-2xl">🔗</span>
                <span className="text-[10px] font-bold text-ink">{tx('AI Chat')}</span>
              </button>
              <button onClick={() => fileInputRef.current?.click()} className="flex-1 bg-white border-[1.5px] border-[rgba(80,70,160,0.1)] rounded-2xl py-2.5 flex flex-col items-center gap-1 cursor-pointer">
                <span className="text-2xl">📄</span>
                <span className="text-[10px] font-bold text-ink">{tx('File')}</span>
              </button>
            </div>
            <button
              onClick={toggleAmbientListening}
              className={clsx(
                'w-full bg-white border-[1.5px] rounded-2xl px-3 py-3 flex items-center justify-between gap-3 cursor-pointer text-left',
                ambientListeningEnabled
                  ? 'border-[rgba(58,136,128,0.24)] bg-[rgba(236,249,247,0.95)]'
                  : 'border-[rgba(80,70,160,0.1)]'
              )}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className={clsx(
                  'w-10 h-10 rounded-2xl flex items-center justify-center text-xl flex-shrink-0',
                  ambientListeningEnabled ? 'bg-teal/15 text-teal' : 'bg-bg-2 text-ink-3'
                )}>
                  👂
                </div>
                <div className="min-w-0">
                  <p className="text-[12px] font-bold text-ink">
                    {ambientListeningEnabled ? tx('Stop Listening') : tx('Start Listening')}
                  </p>
                  <p className="text-[11px] text-ink-4 truncate">
                    {ambientListeningEnabled
                      ? (ambientListeningActive ? tx('后台监听中，可继续使用其他页面') : tx('正在恢复监听…'))
                      : ambientListeningSupported
                        ? tx('开启后可在 app 内持续监听')
                        : tx('当前浏览器暂不支持')}
                  </p>
                </div>
              </div>
              <div className={clsx(
                'w-11 h-6 rounded-full flex items-center px-1 transition-colors',
                ambientListeningEnabled ? 'bg-teal/25 justify-end' : 'bg-[rgba(80,70,160,0.12)] justify-start'
              )}>
                <div className={clsx(
                  'w-4 h-4 rounded-full transition-colors',
                  ambientListeningEnabled ? 'bg-teal' : 'bg-white shadow-[0_2px_4px_rgba(23,18,46,0.12)]'
                )} />
              </div>
            </button>
            {ambientListeningError && (
              <p className="text-[11px] text-rose px-1">{ambientListeningError}</p>
            )}
            <input type="file" ref={photoInputRef} className="hidden" accept="image/*" multiple onChange={handleFileChange} />
            <input type="file" ref={fileInputRef} className="hidden" accept=".pdf,.doc,.docx,.txt,.md,.csv" multiple onChange={handleFileChange} />
          </motion.div>
        )}

        {showAiChatLink && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="bg-white border-[1.5px] border-[rgba(80,70,160,0.1)] rounded-2xl p-2.5 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xl">🤖</span>
              <input
                type="url"
                placeholder={tx('Paste a public AI chat URL...')}
                value={aiChatUrl}
                onChange={(event) => {
                  setAiChatUrl(event.target.value);
                  if (aiChatError) setAiChatError('');
                }}
                className="flex-1 text-[13px] bg-transparent outline-none border-none font-body"
              />
              <button onClick={sendAiChatLink} className="bg-warm text-white px-3 py-1.5 rounded-xl text-xs font-bold">{tx('Share')}</button>
              <button onClick={() => { setShowAiChatLink(false); setAiChatUrl(''); setAiChatError(''); }} className="text-ink-3 text-lg px-1">✕</button>
            </div>
            <p className="text-[11px] text-ink-4">{tx('V1 只支持公开可访问的分享页或普通网页链接，不支持需要登录的私有聊天页。')}</p>
            {aiChatError && <p className="text-[11px] text-rose">{aiChatError}</p>}
          </motion.div>
        )}

        {(speechDraftActive || voiceError || speechInput.error) && (
          <div className="mb-2 px-1 flex items-center justify-between gap-3">
            <p className={clsx('text-[12px] leading-relaxed', voiceError || speechInput.error ? 'text-rose' : 'text-ink-4')}>
              {voiceError || speechInput.error || tx('Whisper 正在听写… {duration}', { duration: formatDuration(speechInput.durationSeconds) })}
            </p>
            {speechDraftActive && (
              <button onClick={cancelSpeechInput} className="text-[11px] font-bold uppercase tracking-wide text-ink-4">
                {tx('Cancel')}
              </button>
            )}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <div className="flex-1 bg-white border-[1.5px] border-[rgba(0,0,0,0.08)] rounded-[24px] flex items-end px-3 py-2 gap-2 shadow-[0_1px_6px_rgba(0,0,0,0.05)]">
            <button onClick={() => setShowMediaPicker(!showMediaPicker)} className={clsx('w-9 h-9 rounded-full bg-bg-2 border-[1.5px] border-[rgba(80,70,160,0.1)] flex items-center justify-center text-2xl font-light text-ink-3 flex-shrink-0 transition-transform', showMediaPicker && 'rotate-45')}>+</button>
            <textarea value={text} onChange={(event) => setText(event.target.value)} onKeyDown={handleKey} placeholder={tx('Type a message…')} rows={1} disabled={speechDraftActive} className="flex-1 text-[15px] text-ink bg-transparent border-none outline-none resize-none min-h-[22px] max-h-[100px] leading-[22px] font-body disabled:opacity-80" />
            <button disabled={speechDraftActive} onClick={send} className="w-[30px] h-[30px] rounded-full bg-warm items-center justify-center flex-shrink-0 border-none cursor-pointer flex disabled:opacity-50"><span className="text-white text-sm font-bold">↑</span></button>
          </div>
          <button
            onClick={toggleSpeechComposer}
            disabled={voiceCallBusy || callInput.isListening || callInput.isFinalizing}
            className={clsx(
              'w-[46px] h-[46px] rounded-full flex items-center justify-center flex-shrink-0 border-none cursor-pointer shadow-[0_3px_14px_rgba(196,82,122,0.4)] transition-transform active:scale-95 disabled:opacity-50',
              speechDraftActive ? 'bg-ink text-white' : 'bg-rose'
            )}
          >
            <span className="text-xl">{speechDraftActive ? '⏹' : '🎙️'}</span>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showVoiceCall && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[10000] overflow-y-auto bg-[#120F17]">
            <div className="mx-auto flex min-h-full w-full max-w-[430px] flex-col bg-[radial-gradient(circle_at_top,_rgba(246,205,214,0.18),_transparent_34%),linear-gradient(180deg,_#231C2D_0%,_#17131E_46%,_#100D15_100%)] px-6 text-white">
              <div
                className="flex items-start justify-between pb-6 pt-6"
                style={{ paddingTop: 'max(env(safe-area-inset-top, 24px), 24px)' }}
              >
                <div>
                  <p className="font-peetu text-[34px] font-black italic tracking-tight text-white">{tx('William')}</p>
                  <p className="mt-2 text-[13px] text-white/55">{getVoiceCallSurfaceText({ tx, callStatusText, callPhase, callRecordingActive, voiceCallBusy, callDuplexActive })}</p>
                </div>
                <button onClick={endVoiceCall} className="flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-white/6 text-lg text-white/70">
                  ✕
                </button>
              </div>

              <div className="flex flex-1 flex-col justify-between pb-6">
                <div className="flex flex-col items-center pt-4">
                  <div className="relative flex h-44 w-44 items-center justify-center rounded-full border border-white/10 bg-white/6 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
                    <motion.div
                      animate={callRecordingActive ? { scale: [1, 1.08, 1] } : voiceCallBusy ? { scale: [1, 1.04, 1] } : { scale: 1 }}
                      transition={{ duration: 1.8, repeat: Infinity }}
                      className={clsx(
                        'absolute inset-5 rounded-full blur-[2px]',
                        callRecordingActive ? 'bg-[radial-gradient(circle,_rgba(92,184,175,0.55),_rgba(92,184,175,0.08)_72%)]' : 'bg-[radial-gradient(circle,_rgba(255,255,255,0.14),_rgba(255,255,255,0.02)_72%)]'
                      )}
                    />
                    <div className="relative flex h-28 w-28 items-center justify-center rounded-full border border-white/10 bg-white/10">
                      <span className="font-peetu text-[36px] font-black italic tracking-tight text-white">P</span>
                    </div>
                  </div>

                  <div className="mt-8 flex min-h-[42px] items-end justify-center gap-1.5 px-4">
                    {[...Array(10)].map((_, index) => (
                      <motion.div
                        key={index}
                        animate={callRecordingActive ? { height: [10, 18 + ((index % 4) * 9), 10] } : voiceCallBusy ? { height: [8, 14, 8] } : { height: callReply ? 8 : 4 }}
                        transition={{ duration: 0.7, repeat: Infinity, delay: index * 0.06 }}
                        className={clsx('w-1.5 rounded-full', callRecordingActive ? 'bg-teal/90' : voiceCallBusy ? 'bg-gold/90' : 'bg-white/18')}
                      />
                    ))}
                  </div>

                  <div className="mt-10 w-full space-y-3 pb-8">
                    <div className="rounded-[28px] border border-white/8 bg-white/6 px-4 py-4 shadow-[0_12px_40px_rgba(0,0,0,0.14)]">
                      <p className="mb-1 text-[11px] uppercase tracking-[0.22em] text-white/35">{tx('You')}</p>
                      <p className="min-h-[48px] text-[15px] leading-6 text-white/82">
                        {callTranscript || tx('直接说话就好，William 会自然接上这通电话。')}
                      </p>
                    </div>
                    <div className="rounded-[28px] border border-white/8 bg-white/[0.09] px-4 py-4 shadow-[0_12px_40px_rgba(0,0,0,0.16)]">
                      <p className="mb-1 font-peetu text-[20px] font-bold italic tracking-tight text-white">{tx('William')}</p>
                      <p className="min-h-[72px] text-[15px] leading-6 text-white">
                        {callReply || tx('William 会持续听你说，并在自然停顿后接住这段对话。')}
                      </p>
                    </div>
                    {(voiceError || callInput.error) && (
                      <div className="rounded-[24px] border border-rose/20 bg-rose/10 px-4 py-3 text-[13px] text-rose-light">
                        {voiceError || callInput.error}
                      </div>
                    )}
                  </div>
                </div>

                <div className="sticky bottom-0 flex flex-col items-center bg-[linear-gradient(180deg,rgba(16,13,21,0)_0%,rgba(16,13,21,0.82)_26%,rgba(16,13,21,0.98)_100%)] pb-2 pt-6" style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 12px), 12px)' }}>
                  <div className="mb-5 text-[28px] font-medium tracking-[0.22em] text-white/88">
                    {formatDuration(callInput.durationSeconds)}
                  </div>
                  <button
                    onClick={endVoiceCall}
                    className="flex h-24 w-24 items-center justify-center rounded-full bg-[#E44E5D] text-[34px] shadow-[0_0_0_10px_rgba(228,78,93,0.16),0_14px_44px_rgba(0,0,0,0.34)] transition-transform active:scale-95"
                    aria-label={tx('End call')}
                  >
                    <span className="-rotate-45">☎</span>
                  </button>
                  <p className="mt-4 text-[11px] uppercase tracking-[0.24em] text-white/34">{tx('Tap the red button to end the call')}</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Overlay open={showVoiceSel} onClose={() => setShowVoiceSel(false)}>
        <p className="text-heading text-2xl mb-1">{tx('Digital twins')}</p>
        <p className="text-[13px] text-ink-3 mb-4">{tx('Choose the William twin you want to talk to right now.')}</p>
        <div className="space-y-2.5 mb-5">
          {VOICES.map((voice) => (
            <button
              key={voice.id}
              onClick={async () => {
                s.set({ voice: voice.id });
                setShowVoiceSel(false);
                haptic('light');
                await api.saveProfile({ voice_mode: voice.id });
              }}
              className={clsx('w-full flex items-center gap-3 p-3.5 rounded-2xl border transition-all', s.voice === voice.id ? 'bg-white border-ink' : 'bg-bg-2 border-transparent')}
            >
              <ModelAvatar voice={voice} size="md" rounded="xl" />
              <div className="flex-1 text-left"><p className="font-bold text-[15px] text-ink">{tx(voice.name)}</p><p className="text-xs text-ink-3">{tx(voice.tag)}</p></div>
              {s.voice === voice.id && <span className="text-teal">✓</span>}
            </button>
          ))}
        </div>
      </Overlay>

      <Overlay open={showHistory} onClose={() => setShowHistory(false)}>
        <p className="text-heading text-2xl mb-1">{tx('Conversation History')}</p>
        <p className="text-[13px] text-ink-3 mb-4">{tx('Recent interactions with William')}</p>
        <div className="space-y-3 mb-6 max-h-[40vh] overflow-y-auto pr-1">
          {temporaryChatEnabled ? (
            <p className="text-sm text-ink-4 text-center py-8 italic">{tx('Temporary chats are not shown in saved history.')}</p>
          ) : s.chat.length === 0 ? <p className="text-sm text-ink-4 text-center py-8 italic">{tx('No history yet.')}</p> :
            [...s.chat].reverse().slice(0, 20).map((message, index) => (
              <div key={`${message.ts}-${index}`} className="bg-white border border-ink/5 rounded-xl p-3 shadow-sm">
                <div className="flex justify-between items-center mb-1">
                  <span className={clsx('text-[9px] font-black uppercase px-1.5 py-0.5 rounded', message.role === 'user' ? 'bg-bg-2 text-ink-3' : 'bg-warm/10 text-warm')}>{message.role === 'user' ? tx('You') : tx('William')}</span>
                  <span className="text-[9px] text-ink-4">{new Date(message.ts).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="text-xs text-ink-2 line-clamp-2">{message.content}</p>
              </div>
            ))
          }
        </div>
        <button onClick={clearHistory} className="w-full bg-rose-light text-rose rounded-xl py-3 text-sm font-bold border border-rose/10 active:bg-rose/10 transition-colors">🗑️ {tx('Clear all history')}</button>
      </Overlay>

      <ScheduleCandidateEditor
        open={Boolean(editingScheduleTarget)}
        candidate={editingScheduleTarget?.candidate || null}
        saving={scheduleBusyId === editingScheduleTarget?.candidate?.id}
        onClose={() => setEditingScheduleTarget(null)}
        onSave={handleScheduleCandidateEdit}
      />
    </div>
  );
}

function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={clsx('text-[11px] font-bold text-ink-3 uppercase tracking-wider', className)}>{children}</span>;
}

function createChatSessionId() {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  return `${minutes}:${remainSeconds < 10 ? '0' : ''}${remainSeconds}`;
}

function mergeSpeechDraft(base: string, finalTranscript: string, interimTranscript: string) {
  const normalizedBase = String(base || '').trim();
  const addition = `${String(finalTranscript || '')}${String(interimTranscript || '')}`.trim();
  if (!normalizedBase) return addition;
  if (!addition) return normalizedBase;
  if (/[A-Za-z0-9]$/.test(normalizedBase) && /^[A-Za-z0-9]/.test(addition)) {
    return `${normalizedBase} ${addition}`;
  }
  return `${normalizedBase}${addition}`;
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeEchoText(text: string) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\u4e00-\u9fff]+/gu, '')
    .trim();
}

function similarityRatio(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  if (!shorter.length || !longer.length) return 0;
  if (longer.includes(shorter)) return shorter.length / longer.length;

  let matches = 0;
  for (const char of shorter) {
    if (longer.includes(char)) matches += 1;
  }
  return matches / longer.length;
}

function shouldSuppressEchoTranscript(transcript: string, lastReply: string, lastReplyFinishedAt: number) {
  const normalizedTranscript = normalizeEchoText(transcript);
  const normalizedReply = normalizeEchoText(lastReply);
  if (!normalizedTranscript || !normalizedReply) return false;
  if (Date.now() - lastReplyFinishedAt > 4000) return false;
  return similarityRatio(normalizedTranscript, normalizedReply) >= 0.72;
}

function getVoiceCallSurfaceText({
  tx,
  callStatusText,
  callPhase,
  callRecordingActive,
  voiceCallBusy,
  callDuplexActive,
}: {
  tx: (key: string, params?: Record<string, string | number>) => string;
  callStatusText: string;
  callPhase: 'idle' | 'listening' | 'thinking' | 'speaking';
  callRecordingActive: boolean;
  voiceCallBusy: boolean;
  callDuplexActive: boolean;
}) {
  if (callRecordingActive) return tx('Listening in real time. Just keep talking.');
  if (callPhase === 'speaking') return tx('William is speaking. You can keep talking naturally.');
  if (voiceCallBusy || callPhase === 'thinking') return tx('William is reflecting on what you just said.');
  if (callDuplexActive) return tx('The line is still open. Talk whenever you are ready.');
  return callStatusText;
}

function buildPendingAttachments(files: File[]): ChatAttachment[] {
  return files.map((file) => ({
    name: file.name,
    path: '',
    type: file.type,
    size: file.size,
    kind: file.type.startsWith('image/')
      ? 'image'
      : file.type.startsWith('audio/')
        ? 'audio'
        : 'document',
    status: 'processing',
  }));
}

function buildPendingLinkAttachment(url: string): ChatAttachment {
  const language = useStore.getState().language || 'zh-CN';
  let hostname = translateText(language, 'AI Chat');
  try {
    hostname = new URL(url).hostname;
  } catch {}

  return {
    name: hostname,
    path: url,
    type: 'text/html',
    size: 0,
    kind: 'document',
    status: 'processing',
    summary: translateText(language, '正在导入链接内容…'),
    meta: {
      sourceType: 'url',
      sourceUrl: url,
    },
  };
}

function AttachmentCard({ attachment, tone = 'light' }: { attachment: ChatAttachment; tone?: 'light' | 'dark' }) {
  const isDark = tone === 'dark';
  const wrapperClass = isDark
    ? 'bg-white/10 border border-white/10 text-white'
    : 'bg-white border border-ink/10 text-ink';
  const mutedClass = isDark ? 'text-white/55' : 'text-ink-4';
  const imageUrl = attachment.path ? api.resolveAssetUrl(attachment.path) : '';
  const isImportedLink = Boolean((attachment.meta as Record<string, unknown> | undefined)?.sourceType === 'url' || /^https?:\/\//.test(attachment.path || ''));

  return (
    <div className={clsx('rounded-xl p-2.5 flex gap-2.5', wrapperClass)}>
      <div className={clsx('w-14 h-14 rounded-lg overflow-hidden flex items-center justify-center text-xl flex-shrink-0', isDark ? 'bg-white/10' : 'bg-bg-2')}>
        {attachment.kind === 'image' && imageUrl ? (
          <img src={imageUrl} alt={attachment.name} className="w-full h-full object-cover" />
        ) : (
          <span>{attachment.kind === 'image' ? '🖼️' : isImportedLink ? '🔗' : attachment.kind === 'document' ? '📄' : '📎'}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold truncate">{attachment.name}</p>
          {attachment.status && (
            <span className={clsx('text-[9px] px-1.5 py-0.5 rounded-full uppercase tracking-wide', isDark ? 'bg-white/10 text-white/70' : 'bg-bg-2 text-ink-4')}>
              {formatAttachmentStatus(attachment.status)}
            </span>
          )}
        </div>
        <p className={clsx('text-[10px] mt-1', mutedClass)}>{formatBytes(attachment.size)}</p>
        {attachment.summary && <p className="text-[11px] leading-relaxed mt-1 line-clamp-3">{attachment.summary}</p>}
        {attachment.excerpt && <p className={clsx('text-[10px] mt-1 line-clamp-3', mutedClass)}>{attachment.excerpt}</p>}
        {isImportedLink && attachment.path && (
          <a href={attachment.path} target="_blank" rel="noreferrer" className={clsx('text-[10px] mt-1 inline-block underline break-all', mutedClass)}>
            {attachment.path}
          </a>
        )}
      </div>
    </div>
  );
}

function ScheduleCandidateCard({
  candidate,
  busy,
  onConfirm,
  onDismiss,
  onEdit,
}: {
  candidate: ScheduleCandidate;
  busy: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
  onEdit: () => void;
}) {
  const { tx } = useI18n();
  const primary = formatScheduleCandidateLabel(candidate);
  const subtitle = [candidate.location, candidate.participants.join(' · ')].filter(Boolean).join(' · ');
  const isConfirmed = candidate.status === 'confirmed';

  return (
    <div className="bg-white border border-[rgba(80,70,160,0.12)] rounded-2xl px-3.5 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-4">{tx('Detected plan')}</p>
          <p className="text-[14px] font-bold text-ink mt-1 leading-snug">{formatScheduleEventTitle(candidate)}</p>
          <p className="text-[11px] text-ink-4 mt-1">
            {candidate.startTime ? primary : `${primary} · ${tx('needs confirmation')}`}
          </p>
          {subtitle && <p className="text-[11px] text-ink-4 mt-1">{subtitle}</p>}
        </div>
        <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-bg-2 text-ink-3">
          {Math.round(candidate.confidence * 100)}%
        </span>
      </div>
      <div className="flex gap-2 mt-3">
        <button
          onClick={onConfirm}
          disabled={busy || isConfirmed}
          className="flex-1 bg-ink text-bg text-[11px] font-bold px-3 py-2 rounded-xl border-none disabled:opacity-50"
        >
          {isConfirmed ? tx('Added to Journey') : tx('Add to Journey')}
        </button>
        {!isConfirmed && (
          <button
            onClick={onDismiss}
            disabled={busy}
            className="px-3 py-2 rounded-xl text-[11px] font-bold bg-bg-2 text-ink-3 border border-[rgba(80,70,160,0.08)] disabled:opacity-50"
          >
            {tx('Dismiss')}
          </button>
        )}
        <button
          onClick={onEdit}
          disabled={busy}
          className="px-3 py-2 rounded-xl text-[11px] font-bold bg-white text-ink-3 border border-[rgba(80,70,160,0.08)] disabled:opacity-50"
        >
          {tx('Edit')}
        </button>
      </div>
    </div>
  );
}

function AssistantPracticeCard({
  item,
  busy,
  onToggle,
  onDismiss,
}: {
  item: NonNullable<ChatMsg['practiceSuggestions']>[number];
  busy: boolean;
  onToggle: (completed: boolean) => void;
  onDismiss: () => void;
}) {
  const { tx } = useI18n();
  const isCompleted = item.status === 'completed';
  const isSaved = Boolean(item.saved);
  const heading = isSaved ? tx('Added to Schedule') : tx('Suggested practice');

  return (
    <div className={clsx(
      'border rounded-2xl px-3.5 py-3 shadow-sm transition-opacity',
      isSaved
        ? 'bg-[rgba(255,255,255,0.6)] border-[rgba(80,70,160,0.08)] opacity-60'
        : 'bg-white border-[rgba(80,70,160,0.12)]'
    )}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-wide text-ink-4">{heading}</p>
          <p className="text-[14px] font-bold text-ink mt-1 leading-snug">{item.title}</p>
          <p className="text-[11px] text-ink-4 mt-1">{item.recommendedTime || tx('Today practice')}</p>
          {item.description && <p className="text-[11px] text-ink-4 mt-1">{item.description}</p>}
        </div>
        <span className={clsx('text-[10px] font-bold px-2 py-1 rounded-full', isCompleted ? 'bg-teal-light text-teal' : isSaved ? 'bg-warm/10 text-warm' : 'bg-bg-2 text-ink-3')}>
          {isCompleted ? tx('Completed') : isSaved ? tx('Added to Schedule') : tx('Suggested')}
        </span>
      </div>
      {!isSaved ? (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => onToggle(true)}
            disabled={busy}
            className="flex-1 bg-ink text-bg text-[11px] font-bold px-3 py-2 rounded-xl border-none disabled:opacity-50"
          >
            {tx('Add to Schedule')}
          </button>
          <button
            onClick={onDismiss}
            disabled={busy}
            className="px-3 py-2 rounded-xl text-[11px] font-bold bg-white text-ink-3 border border-[rgba(80,70,160,0.08)] disabled:opacity-50"
          >
            {tx('Dismiss')}
          </button>
        </div>
      ) : (
        <div className="flex justify-end mt-2">
          <button
            onClick={onDismiss}
            className="px-2 py-1 rounded-lg text-[10px] text-ink-4 hover:text-ink-3 border border-[rgba(80,70,160,0.06)] bg-transparent"
          >
            {tx('Dismiss')}
          </button>
        </div>
      )}
    </div>
  );
}

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatScheduleCandidateLabel(candidate: ScheduleCandidate) {
  const language = useStore.getState().language || 'zh-CN';
  const locale = getIntlLocale(language);
  if (candidate.startTime) {
    const date = new Date(candidate.startTime.replace(' ', 'T'));
    if (!Number.isNaN(date.getTime())) {
      const base = `${formatDateLabel(date, language, locale)} ${formatClock(date, language, locale)}`;
      if (candidate.endTime) {
        const endDate = new Date(candidate.endTime.replace(' ', 'T'));
        if (!Number.isNaN(endDate.getTime())) {
          return `${base}-${formatClock(endDate, language, locale)}`;
        }
      }
      return base;
    }
  }
  return candidate.dateText || translateText(language, 'Time needs confirmation');
}

function formatScheduleEventTitle(candidate: ScheduleCandidate) {
  const language = useStore.getState().language || 'zh-CN';
  let title = String(candidate.title || '').trim();
  const location = String(candidate.location || '').trim();
  if (location) {
    title = title
      .replace(new RegExp(`^(在|到|去)?\\s*${escapeRegExp(location)}`), '')
      .trim();
  }
  return title || candidate.title || translateText(language, 'Planned activity');
}

function formatDateLabel(date: Date, language: string, locale: string) {
  return new Intl.DateTimeFormat(locale, language === 'zh-CN'
    ? { month: '2-digit', day: '2-digit' }
    : { month: 'short', day: 'numeric' }).format(date);
}

function formatClock(date: Date, language: string, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: language !== 'zh-CN',
  }).format(date);
}

function escapeRegExp(text: string) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function mergeHistoryWithTransientMessages(history: ChatMsg[], transientMessages: ChatMsg[]) {
  if (!transientMessages.length) return history;
  const existingKeys = new Set(history.map(buildMessageIdentityKey));
  const uniqueTransientMessages = transientMessages.filter((message) => {
    const key = buildMessageIdentityKey(message);
    return !existingKeys.has(key);
  });
  return [...history, ...uniqueTransientMessages];
}

function buildMessageIdentityKey(message: ChatMsg) {
  if (message.clientId) return `client:${message.clientId}`;
  if (message.id != null) return `id:${message.id}`;
  return `${message.role}:${message.content}:${message.ts}`;
}

function resolveVoiceForMessage(message: ChatMsg, fallbackVoice: (typeof VOICES)[number]) {
  if (message.role !== 'assistant' || !message.voiceId) return fallbackVoice;
  return VOICES.find((voice) => voice.id === message.voiceId) || fallbackVoice;
}

function formatAttachmentStatus(status: ChatAttachment['status']) {
  const language = useStore.getState().language || 'zh-CN';
  switch (status) {
    case 'processing':
      return translateText(language, 'Processing');
    case 'failed':
      return translateText(language, 'Failed');
    case 'ready':
      return translateText(language, 'Ready');
    default:
      return status;
  }
}
