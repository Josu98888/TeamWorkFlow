'use client';

import { useState } from 'react';
import { LANDING_VIDEO_POSTER, LANDING_VIDEO_SRC } from '../content';
import { PlayIcon } from './icons';

/**
 * Parody video, self-hosted so the VPS nginx CSP (`media-src 'self'`) allows it. Nothing loads until the
 * visitor presses play, to keep the page light. Without `NEXT_PUBLIC_LANDING_VIDEO_SRC` it shows "próximamente".
 */
export function LandingVideo() {
  const [playing, setPlaying] = useState(false);
  const hasVideo = LANDING_VIDEO_SRC !== '';

  return (
    <div id="video" className="lp-video">
      <div className="lp-video-frame">
        {playing ? (
          <video src={LANDING_VIDEO_SRC} poster={LANDING_VIDEO_POSTER || undefined} controls autoPlay playsInline />
        ) : (
          <button
            type="button"
            className="lp-video-poster"
            onClick={() => setPlaying(true)}
            disabled={!hasVideo}
            aria-label={hasVideo ? 'Reproducir video: así era antes de TeamWorkFlow' : 'Video próximamente'}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- optional external poster, decorative */}
            {LANDING_VIDEO_POSTER && <img src={LANDING_VIDEO_POSTER} alt="" />}
            <span className="lp-video-play">
              <PlayIcon size={30} filled />
            </span>
            <strong>{hasVideo ? 'Mirá cómo era antes' : 'Video próximamente'}</strong>
            <small>Parodia · menos de 1 minuto</small>
          </button>
        )}
      </div>
    </div>
  );
}
