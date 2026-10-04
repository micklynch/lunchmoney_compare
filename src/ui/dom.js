// Tiny DOM toolkit: hyperscript-lite, sparklines, and a single shared rAF
// ticker for number animations (one loop for the whole page, not N loops).

import { esc, clamp, prefersReducedMotion } from '../lib/util.js';

export const $ = sel => document.querySelector(sel);
export const $$ = sel => Array.from(document.querySelectorAll(sel));
export const byId = id => document.getElementById(id);

/* ── number animation on one shared ticker ──────────────────── */

const animating = new Set();
let rafId = 0;

function tick(now) {
  rafId = 0;
  for (const rec of animating) {
    const p = clamp((now - rec.start) / rec.dur, 0, 1);
    const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p); // easeOutExpo
    rec.el.textContent = rec.fmt(rec.from + (rec.to - rec.from) * e);
    if (p >= 1) {
      rec.el.textContent = rec.fmt(rec.to);
      animating.delete(rec);
    }
  }
  if (animating.size) rafId = requestAnimationFrame(tick);
}

/** Animate numeric text in `el` to `to`, formatted by `fmt`. */
export function setNum(el, to, fmt, dur = 800) {
  if (!el) return;
  const from = typeof el._val === 'number' && Number.isFinite(el._val) ? el._val : 0;
  el._val = to;
  if (prefersReducedMotion() || dur <= 0 || from === to) {
    el.textContent = fmt(to);
    return;
  }
  for (const rec of animating) if (rec.el === el) animating.delete(rec);
  animating.add({ el, from, to, fmt, start: performance.now(), dur });
  if (!rafId) rafId = requestAnimationFrame(tick);
}

export function stopNumAnimations() {
  animating.clear();
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

/* ── SVG sparkline ──────────────────────────────────────────── */

/**
 * Inline SVG sparkline. Cheap (no canvas), crisp at any DPI, and scales to
 * whatever box the CSS gives it thanks to `vector-effect: non-scaling-stroke`.
 */
export function sparkline(values, opts = {}) {
  const {
    w = 120,
    h = 34,
    color = 'currentColor',
    fill = true,
    fillOpacity = 0.16,
    dash = '',
    width = 1.5,
    pad = 1.5,
  } = opts;

  const vals = (values || []).filter(v => Number.isFinite(v));
  if (vals.length < 2) return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"></svg>`;

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (vals.length - 1);
  const y = v => h - pad - ((v - min) / span) * (h - pad * 2);

  let d = '';
  for (let i = 0; i < vals.length; i++) {
    const px = (pad + i * stepX).toFixed(2);
    const py = y(vals[i]).toFixed(2);
    d += (i ? 'L' : 'M') + px + ' ' + py;
  }
  const area = `${d}L${(pad + (vals.length - 1) * stepX).toFixed(2)} ${h}L${pad} ${h}Z`;
  const gid = 'sg' + Math.random().toString(36).slice(2, 8);

  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="${fillOpacity}"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    ${fill ? `<path d="${area}" fill="url(#${gid})" stroke="none"/>` : ''}
    <path d="${d}" fill="none" stroke="${color}" stroke-width="${width}"
      stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"
      ${dash ? `stroke-dasharray="${dash}"` : ''}/>
  </svg>`;
}

/* ── element building ──────────────────────────────────────── */

export function setHTML(el, html) {
  if (el) el.innerHTML = html;
}

export { esc };

/* ── misc ───────────────────────────────────────────────────── */
