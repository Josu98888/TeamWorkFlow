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
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, open]);

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

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
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
    inputRef.current?.focus();
  };

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col items-end">
      {open && (
        <section
          role="dialog"
          aria-label="Asistente de ayuda de TeamWorkFlow"
          className="mb-3 flex h-[480px] w-[360px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-xl dark:shadow-2xl"
        >
          {/* Header */}
          <header className="flex items-center justify-between border-b border-line bg-alt/80 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="grid h-8 w-8 place-items-center rounded-xl bg-brand-medium text-xs font-bold text-white">
                ?
              </span>
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-title">
                  Guía Operativa
                </h2>
                <p className="text-[11px] text-muted">Consultas y paso a paso</p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {messages.length > 1 && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-lg px-2 py-1 text-[11px] font-medium text-muted transition-colors hover:bg-card hover:text-title focus-visible:outline-2 focus-visible:outline-brand-medium"
                >
                  Limpiar
                </button>
              )}
              <button
                type="button"
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
                  {msg.text}
                </div>
                {msg.route && (
                  <Link
                    href={msg.route.href}
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
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Escribí tu duda sobre la app..."
                maxLength={500}
                className="min-w-0 flex-1 rounded-xl border border-line bg-alt/50 px-3 py-2 text-xs text-body outline-none placeholder:text-muted focus:border-brand-medium"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="rounded-xl bg-brand-medium px-3 py-2 text-xs font-semibold text-white transition-opacity hover:opacity-95 focus-visible:outline-2 focus-visible:outline-brand-medium disabled:opacity-40"
              >
                Enviar
              </button>
            </div>
          </form>
        </section>
      )}

      {/* Floating launcher button */}
      <button
        ref={launcherRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-label={open ? 'Cerrar guía de ayuda' : 'Abrir guía de ayuda'}
        className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-4 py-2.5 text-xs font-semibold text-title shadow-md transition-all hover:border-brand-medium hover:shadow-lg focus-visible:outline-2 focus-visible:outline-brand-medium"
      >
        <span className="grid h-5 w-5 place-items-center rounded-full bg-brand-medium text-[11px] font-bold text-white">
          ?
        </span>
        <span>Ayuda</span>
      </button>
    </div>
  );
}