'use client';

import { useState } from 'react';
import { ArrowsIcon, PhoneIcon } from './icons';

/** "A Monday at 8:05" without and with the app; the visitor drags to reveal the ordered side. */
export function CompareSlider() {
  const [pos, setPos] = useState(50);

  return (
    <section className="lp-container" aria-labelledby="lp-cmp-title" style={{ paddingTop: 24 }}>
      <div className="lp-cmp-head">
        <h2 id="lp-cmp-title">
          Un lunes a las 8:05, <span style={{ color: 'var(--lp-lavender)' }}>sin</span> y{' '}
          <span style={{ color: 'var(--lp-mint)' }}>con</span> TeamWorkFlow
        </h2>
        <p className="lp-note">Arrastrá para comparar</p>
      </div>

      <div className="lp-cmp-stage">
        <div className="lp-cmp-side lp-chaos" aria-hidden={pos > 95}>
          <span className="lp-tag lp-tag-bad">SIN LA APP</span>
          <div className="lp-mess lp-chat">
            <div className="lp-chat-head">
              <strong>Grupo Turnos Sede Norte</strong>
              <span>148 sin leer</span>
            </div>
            <span className="lp-bubble">¿Quién cubre mañana a las 6?</span>
            <span className="lp-bubble">Yo no puedo 🙃</span>
            <span className="lp-bubble lp-bubble-me">¿Alguien sabe si llegó Juan?</span>
            <span className="lp-bubble">¿Qué turno tenía yo?</span>
          </div>
          <div className="lp-mess lp-calls">
            <span className="lp-calls-icon">
              <PhoneIcon />
            </span>
            <span>
              <strong>7 llamadas perdidas</strong>
              <small>Supervisor Sede Centro</small>
            </span>
          </div>
          <div className="lp-mess lp-sheet">
            <div className="lp-sheet-title">asistencia_FINAL_v3 (2) - copia.xlsx</div>
            <div className="lp-sheet-grid">
              <span className="h">Empleado</span><span className="h">Entrada</span><span className="h">Salida</span><span className="h">Horas</span>
              <span>Pérez</span><span>¿8:40?</span><span>—</span><span className="err">#REF!</span>
              <span>Gómez</span><span>faltó?</span><span>preguntar</span><span className="err">#VALOR!</span>
              <span>Ruiz</span><span>7:58</span><span>16:02</span><span>8,07 ¿?</span>
            </div>
          </div>
          <div className="lp-mess lp-clock">
            <strong>08:47</strong>
            <small>El puesto 2 sigue vacío y nadie avisó</small>
          </div>
          <div className="lp-mess lp-postit lp-postit-1">Avisarle a Martín que el jueves cambia de sede!!!</div>
          <div className="lp-mess lp-postit lp-postit-2">Cerrar horas del mes antes del viernes 😩</div>
        </div>

        <div className="lp-cmp-side lp-order" style={{ clipPath: `inset(0 0 0 ${pos}%)` }} aria-hidden={pos < 5}>
          <span className="lp-tag lp-tag-good">CON TEAMWORKFLOW</span>
          <div className="lp-tower">
            <div className="lp-tile lp-tile-wide">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>Torre de Control</strong>
                <span className="ok">● En vivo</span>
              </div>
              <div className="lp-row"><span>Sede Norte</span><b>6/6 presentes</b></div>
              <div className="lp-row"><span>Sede Centro</span><b className="warn">5/6 · 1 sin fichar</b></div>
              <div className="lp-row"><span>Sede Sur</span><b>4/4 presentes</b></div>
            </div>
            <div className="lp-tile lp-tile-alert">
              <span className="warn">ALERTA · 08:05</span>
              <strong>Sede Centro: el puesto 2 no fichó</strong>
              <span className="lp-chip">Reasignar turno</span>
            </div>
            <div className="lp-tile">
              <small>Última fichada</small>
              <strong>Ruiz · 07:58</strong>
              <span className="ok">✓ Validada por QR de la sede</span>
            </div>
            <div className="lp-tile lp-tile-hide-sm">
              <small>Horas del mes</small>
              <strong style={{ fontSize: 24 }}>Calculadas</strong>
              <span className="ok">Sin Excel, sin #REF!</span>
            </div>
            <div className="lp-tile lp-tile-hide-sm">
              <small>Turnos de la semana</small>
              <strong>Cada empleado ve el suyo</strong>
              <span className="ok">Sin avisar uno por uno</span>
            </div>
          </div>
        </div>

        <div className="lp-cmp-divider" style={{ left: `${pos}%` }} aria-hidden="true">
          <span className="lp-cmp-handle">
            <ArrowsIcon />
          </span>
        </div>
        <input
          className="lp-cmp-range"
          type="range"
          min={0}
          max={100}
          value={pos}
          onChange={(e) => setPos(Number(e.target.value))}
          aria-label="Comparar sin la app y con TeamWorkFlow"
        />
      </div>
      <div className="lp-cmp-legend" aria-hidden="true">
        <span>← Sin la app</span>
        <span>Con TeamWorkFlow →</span>
      </div>
    </section>
  );
}
