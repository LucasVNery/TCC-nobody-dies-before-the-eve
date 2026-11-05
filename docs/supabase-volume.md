# Event volume for the cloud batch size

Measured with `npm run volume` (`tools/measure-volume.ts`): the 7 synthetic agent styles play through the real game stack
(`playAgent`), seed 4242 only, 3 runs per style, and every event is serialised as one NDJSON line
(`JSON.stringify(event)` + newline, UTF-8 bytes). Read-only: nothing is written to `experiments/`, and what the game logs is not changed.
Two configs: the default no-boss pipeline (cap 600 s/run) and the boss room (`BOSS_CONFIG_DEMO`, `afterEncounters: 1`, cap 120 s/run).

## Results

### Default (no boss)

| style | sim min | events | events/min | bytes/min | bytes/event | max 500-batch KiB | mean batch KiB |
|---|---|---|---|---|---|---|---|
| agressivo | 0.49 | 504 | 1020 | 309683 | 303 | 148.7 | 74.7 |
| evasivo | 14.46 | 12594 | 871 | 251250 | 289 | 146.7 | 136.5 |
| bloqueador | 2.16 | 1839 | 851 | 251568 | 296 | 145.2 | 132.8 |
| paciente | 0.81 | 665 | 824 | 241805 | 293 | 143.0 | 95.2 |
| variado | 1.11 | 964 | 867 | 252316 | 291 | 141.8 | 137.0 |
| repetitivo | 0.69 | 678 | 979 | 297130 | 303 | 147.6 | 100.4 |
| aleatorio | 1.15 | 1020 | 890 | 263017 | 296 | 144.8 | 98.2 |
| ALL | 20.88 | 18264 | 875 | 254525 | 291 | 148.7 | |

### Boss room

| style | sim min | events | events/min | bytes/min | bytes/event | max 500-batch KiB | mean batch KiB |
|---|---|---|---|---|---|---|---|
| agressivo | 0.49 | 504 | 1020 | 309683 | 303 | 148.7 | 74.7 |
| evasivo | 2.88 | 2597 | 901 | 260053 | 289 | 143.0 | 122.0 |
| bloqueador | 2.72 | 2343 | 861 | 256753 | 298 | 146.7 | 136.5 |
| paciente | 0.81 | 665 | 824 | 241805 | 293 | 143.0 | 95.2 |
| variado | 1.11 | 958 | 864 | 254444 | 294 | 142.3 | 137.7 |
| repetitivo | 0.69 | 678 | 979 | 297130 | 303 | 147.6 | 100.4 |
| aleatorio | 0.83 | 755 | 915 | 273890 | 299 | 145.6 | 110.4 |
| ALL | 9.53 | 8500 | 892 | 263377 | 295 | 148.7 | |

Aggregate: about 875-890 events/min and 249-257 KiB/min (14.6-15.1 MiB per hour of raw NDJSON), about 291-295 bytes/event.
Several styles die within a minute, so their absolute durations are small, but the rates are very stable across styles (820-1020 events/min).

### Which event types dominate (all styles together)

| config | top 5 by count | top 5 by bytes |
|---|---|---|
| no boss | obs.record 27.8%, pos.sample 27.4%, obs.action 5.5%, player.action 5.5%, enemy.hurt 5.4% | pos.sample 26.8%, obs.record 19.3%, player.action 7.9%, enemy.hurt 7.3%, player.cancel 6.5% |
| boss room | obs.record 27.0%, pos.sample 26.9%, opp.open 5.6%, opp.close 5.6%, player.action 4.7% | pos.sample 25.9%, obs.record 18.9%, opp.open 8.1%, opp.close 7.8%, player.action 6.8% |

Two chatty types dominate: `pos.sample` and `obs.record` together are about 55% of the events and 46% of the bytes
(`pos.sample` is the single largest by bytes). If the author wants to shrink the volume, these are the levers
(lower sampling rate of `pos.sample`, fewer or leaner `obs.record`); halving both would cut roughly 23% of the bytes.
This was NOT changed. Per-style top-5 lists are printed by `npm run volume`.

## Conclusion

**MAX_BATCH_EVENTS = 500.**

- 500 events is about 145 KiB of NDJSON (max observed 148.7 KiB, mean of full batches about 145 KiB): well under 1 MB and far
  under the typical 1-2 MB request limits, so a batch is one small insert.
- Rows: 500 is the CAP, not the typical row. At full batches it would be about 875-890 events/min / 500 = about 1.8 rows/min
  (about 105 rows per hour), but that is not what the game does. The game persists every 2 s and the background push runs
  about 2 s after each burst, and every confirmed push moves the progress, so the next push starts a NEW row (a batch is a row).
  At about 15 events/s that is a row of about 30-60 events (about 9-18 KiB) every 2-4 s: **about 1000-1800 rows per hour of play**.
  Full 500-event rows only appear when a backlog is sent at once (after playing offline, or at the first sign-in after an import).
- Row count does not change the storage estimate much (the per-row overhead of a few hundred bytes is under 1 MB/h at 1800 rows/h),
  but it matters for the pull on a new machine: one hour of history is 1000-1800 rows. The pull fetches **100 rows per request**
  (`PULL_PAGE_SIZE`, about 1-2 MB per page typically; at most about 14.5 MB if every row were a full batch), keeps each page as it
  arrives, and resumes from the last stored row if the 5 s limit cuts it short. The push sends at most 20 batches per request.

**Storage estimate** (pessimistic: the boss-room rate, 257 KiB/min):

- Raw NDJSON: about 15.1 MiB per hour of play.
- JSONB overhead factor assumed: **1.2x** (jsonb stores about the JSON text size; range 1.0-1.3, binary form with key dictionary
  duplicated per event, no compression of repeated keys across rows beyond TOAST pglz). Plus a few hundred bytes per row of columns
  and indexes (about 1000-1800 rows/h at the real 2 s cadence, so roughly 0.3-0.9 MB/h; small next to 18 MB/h).
- Estimate: about **18 MB per hour of play** = per participant-hour (one participant-hour is one hour of one participant's play).
- Free plan: 500 MB database. Reserving 50% headroom leaves 250 MB usable: 250 / 18 = about **14 participant-hours**
  (about 28 hours with no headroom at all).
- Sensitivity: 1.0x gives about 16.5 h with headroom (33 h without); 1.3x gives about 12.8 h (25.5 h without).

**Caveats.** Agents are not humans. Humans pause, read menus, and are slower on some events (fewer `player.action`/`opp.*` per
minute), but `pos.sample` and `obs.record` appear to be time-driven rather than action-driven, so the per-minute volume should be of the
same order, possibly lower; this was not measured with human data. The agents also finish quickly (under a minute per run for most styles), so long-run
behaviour (and the boss fight itself, which these short runs barely reach) is under-represented. Treat the figures as an
order of magnitude, to be re-checked on the first real participant sessions.

**Flag for the author.** Fewer than 30 participant-hours fit in the free plan with 50% headroom (about 14 h). Options: log less
(thin `pos.sample` / `obs.record`), delete or archive older data after exporting it, or upgrade the plan. The decision is the author's.
