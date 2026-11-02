// Exploratory (post hoc) analysis of the H4 refutation: raw punish windows per run, official V0.1 config.
// Run: npx vite-node experiments/v0/exploratorio/h4-janelas-punish.ts  (prints the table in LEITURA.md, section 3)
import { DEFAULT_EXPERIMENT, playAgent } from '../../../src/experiments/v0/agentRunner';
import { STYLE_IDS, type StyleId } from '../../../src/experiments/v0/styles';

const styles: StyleId[] = ['paciente', 'bloqueador', 'evasivo', 'agressivo'];
const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const cliff = (a: number[], b: number[]) => { let g = 0, l = 0; for (const x of a) for (const y of b) { if (x > y) g++; else if (x < y) l++; } return (g - l) / (a.length * b.length); };
const per: Record<string, { rate: number[]; takenPerMin: number[]; validPerMin: number[]; valid: number[]; tot: Record<string, number> }> = {};
for (const st of styles) {
  const log = playAgent(st, DEFAULT_EXPERIMENT, STYLE_IDS.indexOf(st));
  const runs = new Map<number, { t0: number; t1: number; c: Record<string, number> }>();
  for (const e of log.events as any[]) {
    if (typeof e.run_idx !== 'number') continue;
    const r = runs.get(e.run_idx) ?? { t0: e.t_ms, t1: e.t_ms, c: { taken: 0, missed: 0, expired: 0, invalid: 0 } };
    r.t1 = Math.max(r.t1, e.t_ms); r.t0 = Math.min(r.t0, e.t_ms);
    if (e.type === 'opp.close' && e.opp_type === 'punish') r.c[e.outcome] = (r.c[e.outcome] ?? 0) + 1;
    runs.set(e.run_idx, r);
  }
  const p = { rate: [] as number[], takenPerMin: [] as number[], validPerMin: [] as number[], valid: [] as number[], tot: { taken: 0, missed: 0, expired: 0, invalid: 0 } as Record<string, number> };
  for (const r of runs.values()) {
    const v = r.c.taken + r.c.missed + r.c.expired; const min = (r.t1 - r.t0) / 60000;
    if (min <= 0 || v + r.c.invalid === 0) continue;
    p.valid.push(v); p.takenPerMin.push(r.c.taken / min); p.validPerMin.push(v / min);
    if (v > 0) p.rate.push(r.c.taken / v);
    for (const k of Object.keys(p.tot)) p.tot[k] += r.c[k] ?? 0;
  }
  per[st] = p;
}
for (const st of styles) {
  const p = per[st]; const t = p.tot; const v = t.taken + t.missed + t.expired;
  console.log(`${st}: runs ${p.valid.length}; windows total taken ${t.taken} missed ${t.missed} expired ${t.expired} invalid ${t.invalid}; invalid share ${(t.invalid / (v + t.invalid)).toFixed(2)}; pooled rate ${(t.taken / v).toFixed(3)}; median valid/run ${med(p.valid)}; median rate ${med(p.rate).toFixed(3)}; median taken/min ${med(p.takenPerMin).toFixed(2)}; median valid/min ${med(p.validPerMin).toFixed(2)}`);
}
for (const [a, b] of [['bloqueador', 'evasivo'], ['paciente', 'evasivo']]) {
  console.log(`${a} vs ${b}: delta rate ${cliff(per[a].rate, per[b].rate).toFixed(3)}; delta valid/run ${cliff(per[a].valid, per[b].valid).toFixed(3)}; delta taken/min ${cliff(per[a].takenPerMin, per[b].takenPerMin).toFixed(3)}`);
}
