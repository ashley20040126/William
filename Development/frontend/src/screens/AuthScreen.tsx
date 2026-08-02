import { useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '@/services/store';
import * as api from '@/services/api';
import { Button } from '@/components/ui';
import { useI18n } from '@/i18n/useI18n';

type View = 'welcome' | 'login' | 'signup' | 'forgot';

export default function AuthScreen() {
  const setAuth = useStore((s) => s.setAuth);
  const set = useStore((s) => s.set);
  const { tx } = useI18n();
  const [view, setView] = useState<View>('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resetStep, setResetStep] = useState<'email' | 'code'>('email');
  const [devCode, setDevCode] = useState('');

  const handleLogin = async () => {
    if (!email || !password) {
      setError(tx('Please fill in all fields'));
      return;
    }
    setError('');
    setLoading(true);
    const data = await api.login(email, password);
    setLoading(false);
    if (!data) {
      setError(tx('Invalid email or password'));
      return;
    }
    setAuth(data.token, data.uid);
    if (data.name) set({ name: data.name });
    if (data.onboarded) set({ onboarded: true });
  };

  const handleSignup = async () => {
    if (!email || !password || !name) {
      setError(tx('Please fill in all fields'));
      return;
    }
    if (password.length < 6) {
      setError(tx('Password must be at least 6 characters'));
      return;
    }
    setError('');
    setLoading(true);
    const data = await api.signup(email, password, name);
    setLoading(false);
    if (!data) {
      setError(tx('Email already registered or signup failed'));
      return;
    }
    setAuth(data.token, data.uid);
    set({ name });
  };

  const handleForgotEmail = async () => {
    if (!email) {
      setError(tx('Please enter your email'));
      return;
    }
    setError('');
    setLoading(true);
    const data = await api.forgotPassword(email);
    setLoading(false);
    if (!data?.ok) {
      setError(tx('Failed to send reset code'));
      return;
    }
    if (data.code) setDevCode(data.code);
    setResetStep('code');
  };

  const handleResetPassword = async () => {
    if (!code || !newPassword) {
      setError(tx('Please fill in all fields'));
      return;
    }
    if (newPassword.length < 6) {
      setError(tx('Password must be at least 6 characters'));
      return;
    }
    setError('');
    setLoading(true);
    const data = await api.resetPassword(email, code, newPassword);
    setLoading(false);
    if (!data?.ok) {
      setError(tx('Invalid or expired code'));
      return;
    }
    setView('login');
    setResetStep('email');
    setCode('');
    setNewPassword('');
    setError('');
  };

  const Back = ({ to }: { to: View }) => (
    <button onClick={() => { setView(to); setError(''); }} className="text-2xl text-ink-3 mb-5 bg-transparent border-none cursor-pointer">←</button>
  );

  // Welcome
  if (view === 'welcome') return (
    <div className="h-full flex flex-col bg-ink max-w-[430px] mx-auto">
      <div className="flex-1 flex flex-col items-center justify-center px-12">
        <div className="w-24 h-24 rounded-full bg-[rgba(139,127,204,0.15)] border-[1.5px] border-[rgba(139,127,204,0.3)] flex items-center justify-center mb-8">
          <span className="text-4xl">◆</span>
        </div>
        <h1 className="text-heading text-4xl text-bg mb-2.5">PeetU</h1>
        <p className="text-[15px] text-[rgba(236,234,246,0.4)] text-center leading-relaxed">
          {tx('Your personal AI companion')}<br />{tx('for emotional wellbeing')}
        </p>
      </div>
      <div className="p-7 pb-safe flex flex-col gap-3">
        <Button variant="warm" full onClick={() => setView('signup')}>{tx('Create account')}</Button>
        <button onClick={() => setView('login')} className="py-4 rounded-2xl text-bg text-base font-bold border-[1.5px] border-[rgba(236,234,246,0.15)] bg-transparent cursor-pointer">
          {tx('Sign in')}
        </button>
      </div>
    </div>
  );

  // Login
  if (view === 'login') return (
    <div className="h-full flex flex-col bg-bg max-w-[430px] mx-auto">
      <div className="flex-1 overflow-y-auto px-6 pt-14">
        <Back to="welcome" />
        <h2 className="text-heading text-[28px] mb-1.5">{tx('Welcome back')}</h2>
        <p className="text-[13px] text-ink-3 mb-6">{tx('Sign in to continue your journey')}</p>
        <input
          value={email} onChange={e => setEmail(e.target.value)} placeholder={tx('Email')}
          type="email" autoCapitalize="none"
          className="w-full bg-bg-2 border-[1.5px] border-[rgba(80,70,160,0.1)] rounded-[14px] p-4 text-[15px] text-ink outline-none focus:border-warm mb-2.5"
        />
        <input
          value={password} onChange={e => setPassword(e.target.value)} placeholder={tx('Password')}
          type="password"
          className="w-full bg-bg-2 border-[1.5px] border-[rgba(80,70,160,0.1)] rounded-[14px] p-4 text-[15px] text-ink outline-none focus:border-warm mb-2.5"
        />
        {error && <p className="text-rose text-[13px] mb-2.5">{error}</p>}
        <button onClick={() => setView('forgot')} className="text-[13px] text-warm mb-4 bg-transparent border-none cursor-pointer">
          {tx('Forgot password?')}
        </button>
      </div>
      <div className="p-6 pb-safe">
        <Button full disabled={loading} onClick={handleLogin}>
          {loading ? tx('Signing in...') : tx('Sign in →')}
        </Button>
      </div>
    </div>
  );

  // Signup
  if (view === 'signup') return (
    <div className="h-full flex flex-col bg-bg max-w-[430px] mx-auto">
      <div className="flex-1 overflow-y-auto px-6 pt-14">
        <Back to="welcome" />
        <h2 className="text-heading text-[28px] mb-1.5">{tx('Create account')}</h2>
        <p className="text-[13px] text-ink-3 mb-6">{tx('Start your journey with William')}</p>
        <input
          value={name} onChange={e => setName(e.target.value)} placeholder={tx('Your name')}
          className="w-full bg-bg-2 border-[1.5px] border-[rgba(80,70,160,0.1)] rounded-[14px] p-4 text-[15px] text-ink outline-none focus:border-warm mb-2.5"
        />
        <input
          value={email} onChange={e => setEmail(e.target.value)} placeholder={tx('Email')}
          type="email" autoCapitalize="none"
          className="w-full bg-bg-2 border-[1.5px] border-[rgba(80,70,160,0.1)] rounded-[14px] p-4 text-[15px] text-ink outline-none focus:border-warm mb-2.5"
        />
        <input
          value={password} onChange={e => setPassword(e.target.value)} placeholder={tx('Password (min 6 characters)')}
          type="password"
          className="w-full bg-bg-2 border-[1.5px] border-[rgba(80,70,160,0.1)] rounded-[14px] p-4 text-[15px] text-ink outline-none focus:border-warm mb-2.5"
        />
        {error && <p className="text-rose text-[13px] mb-2.5">{error}</p>}
      </div>
      <div className="p-6 pb-safe">
        <Button full disabled={loading} onClick={handleSignup}>
          {loading ? tx('Creating account...') : tx('Create account →')}
        </Button>
        <button onClick={() => setView('login')} className="text-[13px] text-ink-3 mt-3 w-full bg-transparent border-none cursor-pointer">
          {tx('Already have an account? Sign in')}
        </button>
      </div>
    </div>
  );

  // Forgot password
  if (view === 'forgot') {
    if (resetStep === 'email') return (
      <div className="h-full flex flex-col bg-bg max-w-[430px] mx-auto">
        <div className="flex-1 overflow-y-auto px-6 pt-14">
          <Back to="login" />
          <h2 className="text-heading text-[28px] mb-1.5">{tx('Reset password')}</h2>
          <p className="text-[13px] text-ink-3 mb-6">{tx('Enter your email to receive a reset code')}</p>
          <input
            value={email} onChange={e => setEmail(e.target.value)} placeholder={tx('Email')}
            type="email" autoCapitalize="none"
            className="w-full bg-bg-2 border-[1.5px] border-[rgba(80,70,160,0.1)] rounded-[14px] p-4 text-[15px] text-ink outline-none focus:border-warm mb-2.5"
          />
          {error && <p className="text-rose text-[13px] mb-2.5">{error}</p>}
        </div>
        <div className="p-6 pb-safe">
          <Button full disabled={loading} onClick={handleForgotEmail}>
            {loading ? tx('Sending...') : tx('Send reset code →')}
          </Button>
        </div>
      </div>
    );

    return (
      <div className="h-full flex flex-col bg-bg max-w-[430px] mx-auto">
        <div className="flex-1 overflow-y-auto px-6 pt-14">
          <Back to="login" />
          <h2 className="text-heading text-[28px] mb-1.5">{tx('Enter reset code')}</h2>
          <p className="text-[13px] text-ink-3 mb-6">
            {tx('We sent a 6-digit code to {email}', { email })}
            {devCode && <span className="block mt-2 text-warm font-bold">{tx('Dev code: {code}', { code: devCode })}</span>}
          </p>
          <input
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={tx('6-digit code')}
            type="tel"
            className="w-full bg-bg-2 border-[1.5px] border-[rgba(80,70,160,0.1)] rounded-[14px] p-4 text-[15px] text-ink outline-none focus:border-warm mb-2.5"
          />
          <input
            value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder={tx('New password (min 6 characters)')}
            type="password"
            className="w-full bg-bg-2 border-[1.5px] border-[rgba(80,70,160,0.1)] rounded-[14px] p-4 text-[15px] text-ink outline-none focus:border-warm mb-2.5"
          />
          {error && <p className="text-rose text-[13px] mb-2.5">{error}</p>}
        </div>
        <div className="p-6 pb-safe">
          <Button full disabled={loading} onClick={handleResetPassword}>
            {loading ? tx('Resetting...') : tx('Reset password →')}
          </Button>
          <button onClick={() => setResetStep('email')} className="text-[13px] text-ink-3 mt-3 w-full bg-transparent border-none cursor-pointer">
            {tx("Didn't receive code? Try again")}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
