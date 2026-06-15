'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { CrunchWrapLogo } from '@/components/CrunchWrapLogo';
import { useUIStore } from '@/lib/store';

export default function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const { showToast } = useUIStore();
  const supabase = createClient();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (email.trim() === 'demo@tekguyz.com') {
        document.cookie = "crunch_dev_bypass=true; path=/; max-age=86400; SameSite=None; Secure";
        document.cookie = "crunch_dev_email=demo@tekguyz.com; path=/; max-age=86400; SameSite=None; Secure";
        window.location.href = '/dashboard/hub';
        return;
      }

      if (isSignUp) {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        showToast('Account created! Please check your email.', 'success');
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.push('/dashboard/hub');
      }
    } catch (error: any) {
      showToast(error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      showToast(error.message, 'error');
      setLoading(false);
    }
  };

  const handleBypass = (e: React.MouseEvent) => {
    e.preventDefault();
    document.cookie = "crunch_dev_bypass=true; path=/; max-age=86400; SameSite=None; Secure";
    document.cookie = "crunch_dev_email=demo@tekguyz.com; path=/; max-age=86400; SameSite=None; Secure";
    window.location.href = '/dashboard/hub';
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface p-8 rounded-3xl shadow-m3 border border-border flex flex-col gap-6">
        <div className="flex justify-center">
          <CrunchWrapLogo />
        </div>
        <h1 className="font-serif text-3xl tracking-tight text-foreground text-center">Welcome to Crunch Wrap</h1>
        
        <form onSubmit={handleAuth} className="flex flex-col gap-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-background border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-primary-foreground rounded-full py-3 hover:bg-primary/90 transition-all font-medium"
          >
            {loading ? 'Processing...' : isSignUp ? 'Sign Up' : 'Sign In'}
          </button>
        </form>

        <button
          onClick={() => setIsSignUp(!isSignUp)}
          className="text-sm text-foreground/70 hover:text-foreground transition-colors text-center"
        >
          {isSignUp ? 'Already have an account? Sign in' : "Don't have an account? Sign up"}
        </button>

        <div className="flex items-center gap-4 text-foreground/50 text-sm">
          <div className="h-px flex-1 bg-border"></div>
          or continue with
          <div className="h-px flex-1 bg-border"></div>
        </div>

        <button
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 border border-border rounded-full py-3 hover:bg-foreground/5 transition-colors font-medium text-foreground"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.3-4.74 3.3-8.09z" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.19 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Sign in with Google
        </button>
        <button
          onClick={handleBypass}
          type="button"
          className="mt-2 w-full text-center text-sm font-medium text-primary hover:text-primary/80 hover:underline transition-all"
        >
          Try Demo Mode / Sandbox Bypass (No AI Usage)
        </button>
        <p className="text-[11px] text-foreground/45 text-center -mt-3 leading-relaxed">
          Secure offline preview: test all UI features using simulated local-only intelligence with zero API keys or costs.
        </p>
      </div>
    </div>
  );
}
