// Spend calendar — a GitHub-style contribution grid showing *when* the money
// went, not just how much. Rows are weekdays, columns are weeks; each square's
// shade is a quantile of the user's own daily spending, so the grid adapts to
// their distribution instead of a fixed dollar scale.

import { byId, esc } from '../dom.js';
import { money, compactMoney, pct } from '../../lib/format.js';

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
let tipEl = null;

export function renderCalendar(m) {
  const cal = m.calendar;
  const host = byId('cal-body');
  if (!cal || !cal.weeks) {
    host.innerHTML = `<div class="empty">no calendar data</div>`;
    return;
  }

  /* month captions, aligned to their week column */
  const months = new Array(cal.weeks).fill('');
  for (const ml of cal.monthLabels) {
    if (ml.week < cal.weeks) months[ml.week] = ml.label;
  }

  /* cells, in column-major order so CSS can flow them by week */
  let cells = '';
  let spendDays = 0;
  let quietDays = 0;
  for (const day of cal.days) {
    if (!day) { cells += `<i class="cal-cell pad"></i>`; continue; }
    if (day.level === 0) quietDays++; else spendDays++;
    const cls = day.level < 0 ? 'unknown' : `lv${day.level}`;
    cells += `<i class="cal-cell ${cls}${day.isToday ? ' today' : ''}"
      data-d="${esc(day.date)}" data-v="${day.amount}" data-c="${day.count}"
      tabindex="-1"></i>`;
  }

  host.innerHTML = `
    <div class="cal-months" style="--weeks:${cal.weeks}">
      ${months.map(l => `<span>${esc(l)}</span>`).join('')}
    </div>
    <div class="cal-main">
      <div class="cal-dows">${DOW.map(d => `<span>${d[0]}</span>`).join('')}</div>
      <div class="cal-scroll">
        <div class="cal-grid" style="--weeks:${cal.weeks}">${cells}</div>
      </div>
    </div>`;

  const loading = cal.activeDays === 0;
  byId('cal-meta').textContent = loading
    ? 'loading history…'
    : `last ${cal.weeks} weeks · ${cal.activeDays} days with spending · ${compactMoney(cal.max)} peak day`;

  byId('cal-stats').innerHTML = loading ? '' : `
    <div class="mini"><i>days spent</i><b>${spendDays}<span class="sub"> of ${spendDays + quietDays}</span></b></div>
    <div class="mini"><i>quiet days</i><b>${quietDays}</b></div>
    <div class="mini"><i>peak day</i><b>${money(cal.max)}</b></div>
    <div class="mini"><i>active threshold</i><b>${compactMoney(cal.thresholds[0] || 0)}</b></div>`;

  const total = cal.days.filter(Boolean).reduce((s, d) => s + d.amount, 0);
  const withSpend = Math.max(1, spendDays);
  byId('cal-summary').innerHTML = loading
    ? '<span class="dim">Daily intensity fills in once the full history is loaded.</span>'
    : `You spent money on <b>${pct((withSpend / Math.max(1, spendDays + quietDays)) * 100, 0)}</b> of the last ${cal.weeks} weeks —
       ${money(total)} across ${withSpend} days, averaging <b>${money(total / withSpend)}</b> on a spending day.`;
}

export function bindCalendar() {
  const host = byId('cal-body');

  if (!tipEl) {
    tipEl = document.createElement('div');
    tipEl.className = 'cal-tip';
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
  }

  const show = e => {
    const cell = e.target.closest('.cal-cell[data-d]');
    if (!cell) return hide();
    const amount = Number(cell.dataset.v);
    const count = Number(cell.dataset.c);
    const d = new Date(cell.dataset.d + 'T00:00:00');
    tipEl.innerHTML = `
      <b>${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</b>
      <span>${amount > 0 ? money(amount) : 'no spending'}</span>
      ${count ? `<span class="dim">${count} transaction${count === 1 ? '' : 's'}</span>` : ''}`;
    tipEl.hidden = false;
    const r = cell.getBoundingClientRect();
    const tw = tipEl.offsetWidth;
    const th = tipEl.offsetHeight;
    tipEl.style.left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + 'px';
    tipEl.style.top = Math.max(8, r.top - th - 8) + 'px';
  };

  const hide = () => { if (tipEl) tipEl.hidden = true; };

  host.addEventListener('mousemove', show);
  host.addEventListener('mouseleave', hide);
  host.addEventListener('scroll', hide, true);
  addEventListener('scroll', hide, { passive: true });
}
