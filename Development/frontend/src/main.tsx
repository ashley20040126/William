import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { useStore } from '@/services/store';
import { setToken } from '@/services/api';
import './styles/global.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 60_000 } },
});

/**
 * Rehydrates the auth token from persisted store into the API layer.
 * Does NOT auto-create guest accounts — users must sign in or register.
 */
function AuthProvider({ children }: { children: React.ReactNode }) {
  const token = useStore((s) => s.token);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (token) setToken(token);
    setReady(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return (
      <div className="h-full flex items-center justify-center bg-ink">
        <span className="text-warm text-5xl animate-pulse">◆</span>
      </div>
    );
  }

  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
