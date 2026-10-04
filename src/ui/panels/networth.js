// Net worth panel — exact current balances, history reconstructed from monthly
// cash flow, plus a breakdown by account type.

import { byId, setHTML, setNum, sparkline, esc } from '../dom.js';
import { chart, netWorthChartFactory } from '../../lib/charts.js';
import { money, signedMoney, signedPct, tone } from '../../lib/format.js';

export function renderNetWorth(m) {
  const panel = byId('section-networth');
  const nw = m.netWorth;
  if (!nw) { panel.hidden = true; return; }
  panel.hidden = false;

  chart('networth-chart', netWorthChartFactory, m);

  setNum(byId('nw-total'), nw.current, money);
  const t = tone(nw.delta, 'gain');
  byId('nw-delta').innerHTML = `<span class="chip-delta tone-${t}">${nw.delta >= 0 ? '▲' : '▼'}<b>${signedPct(nw.deltaPct, 1)}</b></span>
    <span class="nw-delta-raw tone-${t}">${signedMoney(nw.delta)}</span>`;
  setHTML(byId('nw-spark'), sparkline(nw.values, { color: 'var(--c-income)', w: 200, h: 40 }));
  byId('nw-meta').textContent = `${nw.count} accounts · history reconstructed from monthly cash flow`;

  byId('nw-stats').innerHTML = `
    <div class="mini"><i>12-mo change</i><b class="tone-${tone(nw.current - nw.values[0], 'gain')}">${signedMoney(nw.current - nw.values[0])}</b></div>
    <div class="mini"><i>peak</i><b>${money(nw.max)}</b></div>
    <div class="mini"><i>trough</i><b>${money(nw.min)}</b></div>
    <div class="mini"><i>vs saved this month</i><b class="tone-${tone(m.net, 'gain')}">${signedMoney(m.net)}</b></div>`;

  const total = nw.buckets.reduce((s, b) => s + Math.abs(b.value), 0) || 1;
  byId('nw-mix').innerHTML = nw.buckets
    .slice()
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .map(b => `<span class="mix-row">
        <i>${esc(b.type)}</i>
        <span class="mix-track"><span class="mix-fill ${b.value < 0 ? 'neg' : ''}" style="width:${((Math.abs(b.value) / total) * 100).toFixed(1)}%"></span></span>
        <b class="${b.value < 0 ? 'tone-bad' : ''}">${money(b.value)}</b>
      </span>`).join('');
}