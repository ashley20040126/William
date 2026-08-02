import { useEffect } from 'react';

/**
 * WebView bridge for communicating with native iOS/Android containers.
 *
 * Native → Web: window.postMessage({ type, payload })
 * Web → Native: window.ReactNativeWebView.postMessage(JSON.stringify({ type, payload }))
 *
 * Supports: Android WebView, iOS WKWebView, React Native WebView
 */

type MessageHandler = (payload: unknown) => void;
const handlers = new Map<string, MessageHandler>();

// Receive messages from native container
if (typeof window !== 'undefined') {
  window.addEventListener('message', (e) => {
    try {
      const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
      if (data?.type && handlers.has(data.type)) {
        handlers.get(data.type)!(data.payload);
      }
    } catch { /* ignore non-JSON messages */ }
  });
}

// Send message to native container
export function sendToNative(type: string, payload?: unknown) {
  const msg = JSON.stringify({ type, payload });
  // React Native WebView
  if ((window as any).ReactNativeWebView?.postMessage) {
    (window as any).ReactNativeWebView.postMessage(msg);
  }
  // Android WebView
  else if ((window as any).Android?.postMessage) {
    (window as any).Android.postMessage(msg);
  }
  // iOS WKWebView
  else if ((window as any).webkit?.messageHandlers?.william?.postMessage) {
    (window as any).webkit.messageHandlers.william.postMessage(msg);
  }
}

// Hook: listen for native messages
export function useNativeMessage(type: string, handler: MessageHandler) {
  useEffect(() => {
    handlers.set(type, handler);
    return () => { handlers.delete(type); };
  }, [type, handler]);
}

// Hook: detect if running inside a WebView
export function useIsWebView(): boolean {
  return !!(
    (window as any).ReactNativeWebView ||
    (window as any).Android ||
    (window as any).webkit?.messageHandlers?.william ||
    navigator.userAgent.includes('wv') ||
    navigator.userAgent.includes('WebView')
  );
}

// Notify native app of route changes
export function notifyRoute(path: string) {
  sendToNative('route_change', { path });
}

// Request native permissions
export function requestNativePermission(perm: string) {
  sendToNative('request_permission', { permission: perm });
}

// Request haptic feedback
export function haptic(type: 'light' | 'medium' | 'heavy' = 'light') {
  sendToNative('haptic', { type });
  // Web fallback
  if (navigator.vibrate) navigator.vibrate(type === 'heavy' ? 50 : type === 'medium' ? 30 : 10);
}
