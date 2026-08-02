import { postJson, postJsonOrThrow } from '@/services/http';

export const guestAuth = () =>
  postJson<{ token: string; uid: number; guest: boolean }>('/api/auth/guest', {});

export const login = (email: string, password: string) =>
  postJson<{ token: string; uid: number; name: string; onboarded: boolean }>('/api/auth/login', { email, password });

export const signup = (email: string, password: string, name: string) =>
  postJson<{ token: string; uid: number }>('/api/auth/signup', { email, password, name });

export const logout = () =>
  postJson('/api/auth/logout', {});

export const logoutOrThrow = () =>
  postJsonOrThrow('/api/auth/logout', {});

export const forgotPassword = (email: string) =>
  postJson<{ ok: boolean; code?: string }>('/api/auth/forgot-password', { email });

export const resetPassword = (email: string, code: string, newPassword: string) =>
  postJson<{ ok: boolean }>('/api/auth/reset-password', { email, code, newPassword });
