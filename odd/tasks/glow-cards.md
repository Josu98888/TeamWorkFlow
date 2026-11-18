# Cards con brillo violeta

## Objective
Darle a `shared/components/Card.tsx` y `shared/components/KpiTile.tsx` un brillo violeta que sale de abajo (esquina inferior derecha), con los colores de la app, en modo claro y oscuro. Lo usan todas las pantallas que ya usan esos componentes.

## Design reference
Prototipo aprobado por el usuario (2026-11-18), en `odd/designs/glow-cards/`:

- `preview.html`: referencia visual (botón "Cambiar tema", hover en las tarjetas). Acepta `?theme=dark`. No se copia tal cual (ver Constraints).
- `desktop.png`, `mobile.png`: claro y oscuro.

## Glow
- Capa `::before` (o un div decorativo con `aria-hidden`) detrás del contenido: `radial-gradient(85% 105% at 100% 118%, glow-1 0%, glow-2 32%, transparent 68%)`. La tarjeta usa `overflow: hidden` e `isolation: isolate`.
- Variante `glow="bottom"` para gráficos y tarjetas anchas: `radial-gradient(85% 70% at 65% 118%, …)`, una luz a lo largo del borde de abajo.
- Variante `glow="none"` para formularios, tablas densas y modales (no todo tiene que brillar).
- Borde de luz sutil: degradé blanco de transparente a 18 % en la parte baja del borde (máscara de 1 px).
- Hover en tarjetas con link: sube 3 px y el brillo crece (`scale(1.15)` desde la esquina). Respetar `prefers-reduced-motion`.

## Tokens (agregar a `globals.css` y al `@theme inline`)
| Token | Claro | Oscuro |
|---|---|---|
| `--glow-1` | `rgba(186,150,204,.95)` | `rgba(222,200,232,.95)` |
| `--glow-2` | `rgba(200,181,206,.55)` | `rgba(140,113,148,.55)` |
| `--chip-bg` | `#EFE6F2` | `#D9C9DE` |
| `--chip-fg` | `--brand-primary` | `#35243B` |
| `--card-shadow` | `0 1px 2px rgba(41,39,43,.04), 0 12px 32px -18px rgba(73,51,79,.35)` | `0 20px 50px -25px rgba(0,0,0,.8)` |

En oscuro, la tarjeta pasa a `#17161B` con un borde blanco al 7 %. Reusar los tokens existentes si alguno coincide (regla de `teamworkflow-tailwind`).

## Card
- Radio de 22 px (hoy `rounded-xl`), `--card-shadow`, brillo por defecto `corner`.
- Nueva prop `glow?: 'corner' | 'bottom' | 'none'` (por defecto `corner`). Mantener `flush` y `className`.

## KpiTile (layout del prototipo)
- Arriba: chip de 34 px (`--chip-bg`/`--chip-fg`, radio de 10 px) con ícono, el `label` en texto normal (ya no en mayúsculas) y un "···" opcional.
- Valor grande (36 px, bold, `tracking-tight`) abajo; admite una parte secundaria más chica (por ejemplo `46` + `/48`).
- Pie: pastilla con el color del `tone` (fondo del color al 12 %, punto con ícono) + el `hint` en gris.
- Nuevas props opcionales: `icon?: ReactNode`, `delta?: string` (texto de la pastilla), `secondary?: string`. Si no viene `delta`, la pastilla no se muestra y el `tone` sigue pintando el valor como hoy, para no romper los usos actuales.
- Altura mínima de 176 px (150 px en celular). En celular se oculta el `hint` largo y queda solo la pastilla.

## Lists inside cards (optional)
Filas con fondo `--bg-main` al 60 %, borde `--border-main`, radio de 14 px, chip de ícono, título, subtítulo y hora a la derecha (ver "Últimas fichadas" en el prototipo).

## Constraints
- Seguir `teamworkflow-frontend`, `teamworkflow-react` y `teamworkflow-tailwind`: tokens semánticos, `cn()`/`cva` para las variantes, sin `#hex` en JSX.
- No cambiar la API existente de `Card`/`KpiTile` de forma incompatible: todos los usos actuales (`TowerView`, `TasksView`, `HomeOverview`, etc.) tienen que compilar sin cambios.
- Los colores de los tonos salen de `Badge.tsx` (`Tone`, `TONE_TEXT`); en oscuro usar las variantes claras del prototipo para que se lean.
- Sin dependencias nuevas.

## Tasks
- [x] G1 Tokens de brillo, chip y sombra en claro y oscuro. Evidence: `frontend/app/globals.css` (`--glow-1/2`, `--chip-bg/fg`, `--tile-bg/border/shadow`, `--color-chip`, `--color-chip-fg`); commit 4e5aa21. Deviation: la sombra de la tarjeta se llama `--tile-shadow` (no `--card-shadow`) porque la rama sidebar ya usa `--card-shadow` para el panel del shell.
- [x] G2 `Card` con radio, sombra y `glow` (`corner` | `bottom` | `none`), más el hover en las tarjetas con link. Evidence: `shared/components/Card.tsx`, `shared/components/card.css` (props `glow` e `interactive`, `prefers-reduced-motion`); formularios y tablas densas con `glow="none"`; commit 4e5aa21.
- [x] G3 `KpiTile` con el nuevo layout (chip con ícono, valor, pastilla de tono), compatible con los usos actuales. Evidence: `shared/components/KpiTile.tsx`, `shared/components/KpiIcon.tsx`; sin `delta` no hay pastilla y `tone` pinta el valor; commit 9d5e32b.
- [x] G4 Agregar íconos y `delta` a los KPI de Torre de Control y usar `glow="bottom"` en sus tarjetas anchas. Evidence: `features/telemetry/components/TowerView.tsx`; `delta` solo en "Presentes ahora" (faltantes calculados de `present`/`expected`), el resto solo ícono; commit bc62a08.
- [ ] G5 Revisar en 1280 y 390 px, en claro y oscuro, contra las capturas; `pnpm lint` y `pnpm build`.

## Progress
G1 a G4 hechas. Checks en `frontend/`: `pnpm lint` 0 errores y 2 warnings previos (`window.location.href`); `npx tsc --noEmit` OK; `pnpm build` OK. Sin navegador: no hubo revisión visual (queda en G5).

## Delivery
Apilada sobre `feat/frontend/sidebar-glass`. Ruta: delegada (un writer). TDD: off.
