'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSession } from '@/shared/hooks/useSession';
import { getGuidesForContext, type AssistantGuide } from '@/shared/lib/assistantGuides';

type ChatMessage = {
  id: string;
  sender: 'assistant' | 'user';
  text: string;
  route?: { label: string; href: string } | null;
  badge?: string;
};

const INITIAL_MESSAGE: ChatMessage = {
  id: 'welcome',
  sender: 'assistant',
  text: 'Hola, soy el asistente operativo de TeamWorkFlow. Elegí una guía rápida o escribime qué necesitás hacer en esta pantalla.',
};

const STORAGE_KEY_PREFIX = 'twf_assistant_messages_';

function loadStoredMessages(role: string | undefined): ChatMessage[] {
  if (typeof window === 'undefined' || !role) return [INITIAL_MESSAGE];
  try {
    const raw = window.sessionStorage.getItem(`${STORAGE_KEY_PREFIX}${role}`);
    if (!raw) return [INITIAL_MESSAGE];
    const parsed = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [INITIAL_MESSAGE];
  } catch {
    return [INITIAL_MESSAGE];
  }
}

function renderFormattedText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|"[^"]+")/g);
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={index} className="font-semibold text-title">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('"') && part.endsWith('"') && part.length > 2) {
      return (
        <strong key={index} className="font-semibold text-title">
          {part.slice(1, -1)}
        </strong>
      );
    }
    return <span key={index}>{part}</span>;
  });
}

export function HelpAssistantWidget() {
  const session = useSession();
  const pathname = usePathname();
  const guides = useMemo(
    () => getGuidesForContext(session?.role, pathname),
    [session?.role, pathname],
  );

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);

  const [historyRole, setHistoryRole] = useState<string | undefined>(undefined);
  if (session?.role !== historyRole) {
    setHistoryRole(session?.role);
    setMessages(loadStoredMessages(session?.role));
    setInput('');
  }

  useEffect(() => {
    if (typeof window === 'undefined' || !session?.role) return;
    try {
      window.sessionStorage.setItem(
        `${STORAGE_KEY_PREFIX}${session.role}`,
        JSON.stringify(messages.slice(-20)),
      );
    } catch {
      // Ignore storage quota errors
    }
  }, [messages, session?.role]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

  // Global shortcut Ctrl+J / Cmd+J to toggle the operational guide
  useEffect(() => {
    const handleGlobalShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleGlobalShortcut);
    return () => window.removeEventListener('keydown', handleGlobalShortcut);
  }, []);

  useEffect(() => {
    if (!open) return;

    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 50);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        launcherRef.current?.focus();
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const handleSelectGuide = (guide: AssistantGuide) => {
    const formattedSteps = guide.steps.map((step, i) => `${i + 1}. ${step}`).join('\n');
    setMessages((prev) => [
      ...prev,
      {
        id: `u-${Date.now()}`,
        sender: 'user',
        text: guide.question,
      },
      {
        id: `a-${Date.now() + 1}`,
        sender: 'assistant',
        text: formattedSteps,
        route: guide.route && guide.route.href !== pathname ? guide.route : null,
        badge: 'Guía rápida',
      },
    ]);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      sender: 'user',
      text: trimmed,
    };

    const history = messages
      .filter((msg) => msg.id !== 'welcome')
      .slice(-6)
      .map((msg) => ({ sender: msg.sender, text: msg.text }));

    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: trimmed,
          role: session?.role ?? null,
          currentPath: pathname,
          history,
        }),
      });

      const data = (await response.json()) as {
        reply?: string;
        error?: string;
        route?: { label: string; href: string } | null;
        source?: string;
      };

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now() + 1}`,
          sender: 'assistant',
          text: data.reply ?? data.error ?? 'No pude procesar la consulta en este momento.',
          route: data.route ?? null,
          badge: data.source === 'gemini' ? 'Asistente IA' : 'Guía operativa',
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now() + 1}`,
          sender: 'assistant',
          text: 'Sin conexión con el servidor. Podés usar cualquiera de las guías rápidas de arriba.',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setMessages([INITIAL_MESSAGE]);
    setInput('');
    if (typeof window !== 'undefined' && session?.role) {
      window.sessionStorage.removeItem(`${STORAGE_KEY_PREFIX}${session.role}`);
    }
    inputRef.current?.focus();
  };

return (
    <div ref={containerRef} className="relative">
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={open ? 'Cerrar guía operativa' : 'Abrir guía operativa (Ctrl+J)'}
        title="Guía operativa (Ctrl+J)"
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide uppercase transition-all duration-150 cursor-pointer border active:scale-95"
        style={
          open
            ? {
                borderColor: 'var(--brand-medium)',
                backgroundColor: 'var(--bg-alt)',
                color: 'var(--text-title)',
              }
            : {
                borderColor: 'var(--border-main)',
                backgroundColor: 'var(--bg-main)',
                color: 'var(--text-body)',
              }
        }
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`transition-transform duration-200 ${open ? 'rotate-12' : ''}`}
        >
          <circle cx="8" cy="8" r="6.5" />
          <path d="M6.2 6.2a1.9 1.9 0 0 1 3.6.6c0 1.3-1.8 1.8-1.8 2.9" />
          <circle cx="8" cy="12" r="0.6" fill="currentColor" stroke="none" />
        </svg>
        <span>Guía</span>
      </button>

<section
        role="dialog"
        aria-label="Asistente de ayuda de TeamWorkFlow"
        aria-hidden={!open}
        style={{
          clipPath: open ? 'inset(0 0 -16px 0 round 12px)' : 'inset(0 0 100% 0 round 12px)',
          transition:
            'clip-path 320ms cubic-bezier(0.22, 1, 0.36, 1), transform 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 220ms ease',
        }}
        className={`fixed right-4 top-16 z-50 mt-1 flex h-[480px] w-[370px] max-w-[calc(100vw-2rem)] origin-top flex-col overflow-hidden rounded-xl border border-line bg-card shadow-xl motion-reduce:transition-none sm:absolute sm:right-0 sm:top-full sm:mt-2 ${
          open
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none -translate-y-1 opacity-0'
        }`}
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-line bg-alt/80 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-medium text-xs font-bold text-white">
              ?
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold uppercase tracking-wider text-title">
                  Guía Operativa
                </h2>
                <kbd className="hidden rounded border border-line bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline">
                  Ctrl+J
                </kbd>
              </div>
              <p className="text-[11px] text-muted">Consultas y paso a paso</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {messages.length > 1 && (
              <button
                type="button"
                tabIndex={open ? 0 : -1}
                onClick={handleReset}
                className="rounded-lg px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-card hover:text-title focus-visible:outline-2 focus-visible:outline-brand-medium"
              >
                Limpiar
              </button>
            )}
            <button
              type="button"
              tabIndex={open ? 0 : -1}
              onClick={() => setOpen(false)}
              aria-label="Cerrar asistente"
              title="Cerrar (Esc)"
              className="grid h-7 w-7 place-items-center rounded-lg text-sm font-semibold text-muted transition-colors hover:bg-card hover:text-title focus-visible:outline-2 focus-visible:outline-brand-medium"
            >
              ✕
            </button>
          </div>
        </header>

        {/* Preset quick-access questions filtered by user role and active screen */}
        <div className="border-b border-line bg-alt/40 px-3 py-2.5">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
            Preguntas frecuentes
          </p>
          <div className="flex flex-wrap gap-1.5">
            {guides.map((guide) => {
              const isCurrentView =
                Boolean(guide.route?.href) &&
                guide.route?.href !== '/' &&
                (pathname === guide.route?.href ||
                  pathname.startsWith(`${guide.route?.href}/`));

              return (
                <button
                  key={guide.id}
                  type="button"
                  tabIndex={open ? 0 : -1}
                  onClick={() => handleSelectGuide(guide)}
                  className={`rounded-lg border bg-card px-2.5 py-1 text-left text-[11px] font-medium text-body transition-colors hover:border-brand-medium hover:text-title focus-visible:outline-2 focus-visible:outline-brand-medium ${
                    isCurrentView ? 'border-brand-medium/60 font-semibold text-title' : 'border-line'
                  }`}
                >
                  {guide.question}
                </button>
              );
            })}
          </div>
        </div>

        {/* Conversation thread */}
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3 text-xs">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${
                msg.sender === 'user' ? 'items-end' : 'items-start'
              }`}
            >
              {msg.badge && msg.sender === 'assistant' && (
                <span className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {msg.badge}
                </span>
              )}
              <div
                className={`max-w-[88%] whitespace-pre-line rounded-xl px-3 py-2 leading-relaxed ${
                  msg.sender === 'user'
                    ? 'bg-brand-medium text-white'
                    : 'border border-line bg-alt/60 text-body'
                }`}
              >
                {msg.sender === 'assistant' ? renderFormattedText(msg.text) : msg.text}
              </div>
              {msg.route && msg.route.href !== pathname && (
                <Link
                  href={msg.route.href}
                  tabIndex={open ? 0 : -1}
                  onClick={() => setOpen(false)}
                  className="mt-1.5 inline-flex items-center gap-1 rounded-lg border border-line bg-card px-2.5 py-1 text-[11px] font-semibold text-title transition-colors hover:border-brand-medium focus-visible:outline-2 focus-visible:outline-brand-medium"
                >
                  {msg.route.label} →
                </Link>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex items-start">
              <div className="rounded-xl border border-line bg-alt/60 px-3 py-2 text-xs text-muted">
                Consultando guía...
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Free-text AI input */}
        <form onSubmit={handleSubmit} className="border-t border-line bg-card p-2.5">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              tabIndex={open ? 0 : -1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribí tu duda sobre la app..."
              maxLength={500}
              className="min-w-0 flex-1 rounded-xl border border-line bg-alt/50 px-3 py-2 text-xs text-body outline-none placeholder:text-muted focus:border-brand-medium"
            />
            <button
              type="submit"
              tabIndex={open ? 0 : -1}
              disabled={loading || !input.trim()}
              className="rounded-xl bg-brand-medium px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-95 focus-visible:outline-2 focus-visible:outline-brand-medium disabled:opacity-40"
            >
              Enviar
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}