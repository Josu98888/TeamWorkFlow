import { NextResponse } from 'next/server';
import {
  TEAMWORKFLOW_SYSTEM_PROMPT,
  findLocalFallbackGuide,
  getGuidesForRole,
} from '@/shared/lib/assistantGuides';

type RequestPayload = {
  message?: string;
  role?: string | null;
  currentPath?: string | null;
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

  const contextualPrompt = `Contexto de sesión actual:
- Rol del usuario: ${role ?? 'desconocido'}
- Pantalla actual donde está parado: ${currentPath}

Consulta del usuario:
${message}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: TEAMWORKFLOW_SYSTEM_PROMPT }],
          },
          contents: [
            {
              role: 'user',
              parts: [{ text: contextualPrompt }],
            },
          ],
          generationConfig: {
            temperature: 0.25,
            maxOutputTokens: 380,
          },
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Gemini API status ${response.status}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: {
          parts?: Array<{ text?: string }>;
        };
      }>;
    };

    const reply = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!reply) {
      throw new Error('Empty Gemini response');
    }

    const relatedGuide = findLocalFallbackGuide(message, role);

    return NextResponse.json({
      reply,
      route:
        relatedGuide?.route && relatedGuide.route.href !== currentPath
          ? relatedGuide.route
          : null,
      source: 'gemini',
    });
  } catch {
    const roleGuides = getGuidesForRole(role);
    const matched = findLocalFallbackGuide(message, role) ?? roleGuides[0];
    return NextResponse.json({
      reply: `Te comparto la guía operativa relacionada:\n\n${formatGuideText(matched.steps)}`,
      route: matched.route ?? null,
      source: 'local-fallback',
    });
  }
}