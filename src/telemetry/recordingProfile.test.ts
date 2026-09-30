import { describe, it, expect } from 'vitest';
import type { ProfileSink } from '../profile/profileSink';
import { RecordingProfile, RECORD_FLUSH_INTERVAL_MS } from './recordingProfile';

function make() {
  const forwarded: string[] = [];
  const inner: ProfileSink = {
    record: (s, n, d) => forwarded.push(`record:${s}:${n}:${d}`),
    recordOutcome: (s, o) => forwarded.push(`outcome:${s}:${o}`),
    recordAction: (t, w) => forwarded.push(`action:${t}:${w}`),
    recordDefense: (l) => forwarded.push(`defense:${l}`),
    applyEncounterBoundary: () => forwarded.push('boundary:encounter'),
    applyRoomBoundary: () => forwarded.push('boundary:room'),
    resetSession: () => forwarded.push('reset'),
  };
  const logged: Array<[string, Record<string, unknown>]> = [];
  let now = 0;
  const rec = new RecordingProfile(inner, (t, p) => logged.push([t, p]), () => now);
  return { rec, forwarded, logged, setNow: (t: number) => { now = t; } };
}

describe('RecordingProfile', () => {
  it('logs and forwards non-aggregated writes immediately', () => {
    const { rec, forwarded, logged } = make();
    rec.recordAction('light', 'sword_shield');
    rec.recordAction('throw');
    rec.recordDefense('parry');
    rec.recordOutcome('punish', 'taken');
    expect(logged).toEqual([
      ['obs.action', { actionType: 'light', weaponId: 'sword_shield' }],
      ['obs.action', { actionType: 'throw' }],
      ['obs.defense', { label: 'parry' }],
      ['obs.outcome', { skill: 'punish', outcome: 'taken' }],
    ]);
    expect(forwarded).toEqual([
      'action:light:sword_shield', 'action:throw:undefined', 'defense:parry', 'outcome:punish:taken',
    ]);
  });

  it('aggregates record() per skill and flushes the sum once 250ms of sim time have passed', () => {
    const { rec, forwarded, logged, setNow } = make();
    rec.record('distance', 0.5, 1);
    setNow(100);
    rec.record('distance', 0.25, 1);
    expect(logged).toEqual([]);
    expect(forwarded).toEqual([]);

    setNow(RECORD_FLUSH_INTERVAL_MS);
    rec.record('distance', 0, 1);

    expect(logged).toEqual([['obs.record', { skill: 'distance', num: 0.75, den: 3 }]]);
    expect(forwarded).toEqual(['record:distance:0.75:3']);
  });

  it('flushes every pending skill before a boundary, and before logging the boundary', () => {
    const { rec, logged, forwarded } = make();
    rec.record('distance', 1, 1);
    rec.record('patience', 0, 1);
    rec.applyEncounterBoundary();
    rec.applyRoomBoundary();
    expect(logged.map(([t, p]) => (t === 'obs.record' ? `${t}:${p.skill}` : `${t}:${String(p.kind ?? '')}`))).toEqual([
      'obs.record:distance', 'obs.record:patience', 'obs.boundary:encounter', 'obs.boundary:room',
    ]);
    expect(forwarded).toEqual([
      'record:distance:1:1', 'record:patience:0:1', 'boundary:encounter', 'boundary:room',
    ]);
  });

  it('resetSession flushes pending evidence, then logs obs.reset and forwards', () => {
    const { rec, logged, forwarded } = make();
    rec.record('distance', 1, 1);
    rec.resetSession();
    expect(logged.map(([t]) => t)).toEqual(['obs.record', 'obs.reset']);
    expect(forwarded).toEqual(['record:distance:1:1', 'reset']);
  });

  it('flushPending() (tab hide) logs and forwards the pending sum together', () => {
    const { rec, logged, forwarded } = make();
    rec.record('distance', 0.1, 0.2);
    rec.flushPending();
    expect(logged).toEqual([['obs.record', { skill: 'distance', num: 0.1, den: 0.2 }]]);
    expect(forwarded).toEqual(['record:distance:0.1:0.2']);
    rec.flushPending(); // nothing pending -> no-op
    expect(logged).toHaveLength(1);
  });
});
