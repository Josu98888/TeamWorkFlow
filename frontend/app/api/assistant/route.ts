import dns from 'node:dns';
import { NextResponse } from 'next/server';
import {
  TEAMWORKFLOW_SYSTEM_PROMPT,
  findLocalFallbackGuide,
  getGuidesForRole,
  resolveAllowedRoute,
} from '@/shared/lib/assistantGuides';

dns.setDefaultResultOrder('ipv4first');

type HistoryTurn = {
  sender: 'user' | 'assistant';
  text: string;
};

type RequestPayload = {
  message?: string;
  role?: string | null;
  currentPath?: string | null;
  history?: HistoryTurn[];
};

type StructuredGeminiReply = {
  reply?: string;
  routeHref?: string | null;
};

function formatGuideText(steps: string[]): string {
  return steps.map((step, index) => `${index + 1}. ${step}`).join('\n');
}

export async function POST(request: Request) {
  let body: RequestPayload;
  try {
    body = (await request.json()) as RequestPayload;
  } catch {
    return NextResponse.json({ error: 'Solicitud inválida.' }, { status: 400 });
  }

  const message = body.message?.trim();
  if (!message) {
    return NextResponse.json({ error: 'Escribí una consulta.' }, { status: 400 });
  }

  if (message.length > 500) {
    return NextResponse.json(
      { error: 'La consulta es demasiado larga (máximo 500 caracteres).' },
      { status: 400 },
    );
  }

  const role = body.role ?? null;
  const currentPath = body.currentPath ?? '/';
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    const matched = findLocalFallbackGuide(message, role);
    if (matched) {
      return NextResponse.json({
        reply: `${matched.question}\n\n${formatGuideText(matched.steps)}`,
        route: matched.route ?? null,
        source: 'local-guide',
      });
    }

    return NextResponse.json({
      reply:
        'Todavía no está configurada la clave de IA en este entorno, pero podés usar cualquiera de las guías rápidas de arriba.',
      route: null,
      source: 'local-fallback',
    });
  }

  const recentHistory = Array.isArray(body.history)
    ? body.history
        .filter(
          (item): item is HistoryTurn =>
            (item?.sender === 'user' || item?.sender === 'assistant') &&
            typeof item?.text === 'string' &&
            item.text.trim().length > 0,
        )
        .slice(-6)
    : [];

  const contextualPrompt = `Contexto de sesión actual:
- Rol del usuario: ${role ?? 'desconocido'}
- Pantalla actual donde está parado: ${currentPath}

Consulta del usuario:
${message}

Respondé en JSON con:
- "reply": texto de la respuesta operativa siguiendo todas las reglas del sistema.
- "routeHref": ruta exacta de la pantalla a la que debería ir el usuario si corresponde navegar (ej. "/asistencia", "/turnos", "/torre-control", "/sedes", "/tareas", "/empleados", "/usuarios", "/facturacion", "/mi-jornada") o null si ya está en esa pantalla o no hace falta navegar.`;

  const contents = [
    ...recentHistory.map((turn) => ({
      role: turn.sender === 'assistant' ? 'model' : 'user',
      parts: [{ text: turn.text.slice(0, 800) }],
    })),
    {
      role: 'user',
      parts: [{ text: contextualPrompt }],
    },
  ];

  const models = [
    'gemini-flash-latest',
    'gemini-2.5-flash',
    'gemini-flash-lite-latest',
    'gemini-3.8-flash',
  ];

  try {
    let parsedReply: StructuredGeminiReply | null = null;

    for (const model of models) {
      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            signal: AbortSignal.timeout(12000),
            body: JSON.stringify({
              systemInstruction: {
                parts: [{ text: TEAMWORKFLOW_SYSTEM_PROMPT }],
              },
              contents,
              generationConfig: {
                temperature: 0.25,
                maxOutputTokens: 700,
                responseMimeType: 'application/json',
                responseSchema: {
                  type: 'OBJECT',
                  properties: {
                    reply: { type: 'STRING' },
                    routeHref: { type: 'STRING', nullable: true },
                  },
                  required: ['reply', 'routeHref'],
                },
              },
            }),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          console.warn(`[assistant] ${model} no disponible (${response.status}):`, errorText);
          continue;
        }

        const data = (await response.json()) as {
          candidates?: Array<{
            content?: {
              parts?: Array<{ text?: string }>;
            };
          }>;
        };

        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        if (rawText) {
          parsedReply = JSON.parse(rawText) as StructuredGeminiReply;
          if (parsedReply?.reply?.trim()) {
            break;
          }
        }
      } catch (modelErr) {
        console.warn(`[assistant] ${model} error/timeout, probando siguiente:`, modelErr);
        continue;
      }
    }

    if (!parsedReply?.reply?.trim()) {
      throw new Error('All Gemini models unavailable');
    }

    const aiRoute = resolveAllowedRoute(parsedReply.routeHref, role);
    const fallbackGuide = findLocalFallbackGuide(message, role);
    const resolvedRoute =
      aiRoute ??
      (fallbackGuide?.route ? resolveAllowedRoute(fallbackGuide.route.href, role) : null);

    return NextResponse.json({
      reply: parsedReply.reply.trim(),
      route: resolvedRoute && resolvedRoute.href !== currentPath ? resolvedRoute : null,
      source: 'gemini',
    });
  } catch (err) {
    console.error('[assistant] Fallback triggered:', err);
    const roleGuides = getGuidesForRole(role);
    const matched = findLocalFallbackGuide(message, role) ?? roleGuides[0];
    return NextResponse.json({
      reply: `Te comparto la guía operativa relacionada:\n\n${formatGuideText(matched.steps)}`,
      route: matched.route ?? null,
      source: 'local-fallback',
    });
  }
}