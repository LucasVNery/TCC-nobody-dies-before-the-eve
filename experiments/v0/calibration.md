# V0 — pilot calibration of the agent styles (raw behaviour only)

- **Date:** 2026-10-19
- **Command:** `npx vite-node tools/calibrate-v0.ts [--seed N] [--runs N] [--agents a,b]`
- **Pilot config:** seed **1** (robustness check: seed **2**). Both differ from the experiment seed
  `20261019`, so the final experiment is not the calibration data. 10 runs per agent,
  10 runs per session, run cap 300 s simulated, step 1000/60 ms, default humanizer
  (reaction log-normal 250/60 ms, lapse 5%, aim noise 0.05 rad). `GAME_VERSION` 0.0.3+viewB.
- **Rule (spec §2 anti-objective):** the script only counts behaviour in the log. It computes
  no profile dimension, no Cliff's delta, no ICC, no bootstrap and no verdict for H1–H14, and
  nothing below was tuned to make a dimension or a separation look good.

## What the script measures

Per style, over the non-empty runs of the pilot (empty runs = the run the director opens after
the death that ends a session; they have no evidence and are listed but not counted):

- runs completed (death) / truncated (cap) / empty; mean, median and minimum run duration
  (run.start to the last event of that run in its own session);
- executed actions (`player.action`) per minute, by action id and by weapon; weapon changes per
  minute = changes of `weaponId` between consecutive executed actions of a run;
- `obs.defense` counts by label (dodge / block / parry / retreat);
- distance from `pos.sample` (top-left to top-left, equal-size boxes, so centre to centre):
  M2 = the metrics aggregator's time-weighted mean (`metricsFromLog`, history window), the
  median of the samples, the mean over samples where the enemy is `attacking` or `recovering`
  (the exchange itself), and the fraction of samples at or below 60 px (the enemy's attack range,
  about the melee reach of the player's weapons);
- fraction of executed actions logged with `ctx.e_state === 'attacking'` (for charged actions the
  event fires on release, so this is "attack executed while the enemy attacks");
- `enemy.attack_start` per minute; `opp.close` per type and outcome (valid = taken + missed +
  expired; invalid = out of range / interrupted, which the profile does not count);
- rooms entered per run, kills (`enemy.death`) per death, and the longest stretch without an
  executed action (max over runs, and median over runs of the per-run max) as a stall check.

## Round 0 — initial values (Task 4 styles, original policy)

Seed 1. (Columns added later — median distance, engaged distance, valid opportunity counts — are
not in this first table.)


### Runs, cadence, space, data

| style | compl | trunc | empty | mean run s | median run s | min run s | actions/min | weapon changes/min | M2 mean dist px | in melee (<=60px) | attacks w/ enemy attacking | enemy attacks/min | rooms/run | kills/death | max action gap s (median of runs) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| agressivo | 10 | 0 | 1 | 11.2 | 10.2 | 7.8 | 47.2 | 2.1 | 265.0 | 47% | 48% | 34.3 | 1.0 | 1.40 | 4.2 (3.4) |
| evasivo | 8 | 2 | 1 | 223.4 | 230.9 | 135.1 | 55.9 | 3.3 | 258.6 | 7% | 21% | 13.6 | 12.7 | 45.63 | 4.8 (3.9) |
| bloqueador | 10 | 0 | 1 | 21.9 | 22.2 | 9.5 | 49.3 | 0.0 | 206.0 | 59% | 27% | 41.4 | 1.8 | 3.30 | 4.1 (3.2) |
| paciente | 10 | 0 | 1 | 28.3 | 25.0 | 12.9 | 38.0 | 3.0 | 212.4 | 45% | 6% | 42.0 | 1.7 | 3.00 | 5.1 (3.8) |
| variado | 10 | 0 | 1 | 17.3 | 18.1 | 8.8 | 41.7 | 8.7 | 270.1 | 44% | 45% | 36.8 | 1.5 | 2.60 | 5.0 (3.9) |
| repetitivo | 10 | 0 | 1 | 19.9 | 19.6 | 9.7 | 52.8 | 0.0 | 220.4 | 52% | 39% | 41.0 | 1.4 | 2.20 | 4.3 (3.2) |
| aleatorio | 10 | 0 | 1 | 12.6 | 13.1 | 9.3 | 40.4 | 25.2 | 268.2 | 43% | 40% | 36.1 | 1.2 | 1.90 | 4.3 (3.4) |

### Executed actions per minute by action id (share of executed actions)

| style | sword_shield.light | sword_shield.heavy | sword_shield.charged | heavy_weapon.light | heavy_weapon.heavy | heavy_weapon.charged | bow.shot | max share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| agressivo | 8.6 (18%) | 4.8 (10%) | 0.5 (1%) | 19.3 (41%) | 10.7 (23%) | 3.2 (7%) | 0.0 (0%) | 41% |
| evasivo | 8.9 (16%) | 4.5 (8%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 42.5 (76%) | 76% |
| bloqueador | 36.4 (74%) | 12.9 (26%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 74% |
| paciente | 19.7 (52%) | 5.7 (15%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 12.5 (33%) | 52% |
| variado | 3.1 (8%) | 5.9 (14%) | 4.5 (11%) | 8.3 (20%) | 3.8 (9%) | 5.2 (13%) | 10.8 (26%) | 26% |
| repetitivo | 52.8 (100%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 100% |
| aleatorio | 6.7 (16%) | 7.1 (18%) | 4.3 (11%) | 4.8 (12%) | 8.1 (20%) | 4.8 (12%) | 4.8 (12%) | 20% |

### Executed actions per minute by weapon (share)

| style | sword_shield | bow | heavy_weapon |
| --- | --- | --- | --- |
| agressivo | 13.9 (30%) | 0.0 (0%) | 33.2 (70%) |
| evasivo | 13.4 (24%) | 42.5 (76%) | 0.0 (0%) |
| bloqueador | 49.3 (100%) | 0.0 (0%) | 0.0 (0%) |
| paciente | 25.5 (67%) | 12.5 (33%) | 0.0 (0%) |
| variado | 13.6 (33%) | 10.8 (26%) | 17.4 (42%) |
| repetitivo | 52.8 (100%) | 0.0 (0%) | 0.0 (0%) |
| aleatorio | 18.1 (45%) | 4.8 (12%) | 17.6 (44%) |

### obs.defense by label (count, share) and opportunities (total (taken/missed/expired/invalid))

| style | dodge | block | parry | retreat | block+parry share | dodge opp | punish opp |
| --- | --- | --- | --- | --- | --- | --- | --- |
| agressivo | 5 (56%) | 0 (0%) | 4 (44%) | 0 (0%) | 44% | 64 (4/40/18/2) | 49 (36/0/8/5) |
| evasivo | 287 (89%) | 0 (0%) | 18 (6%) | 17 (5%) | 6% | 508 (0/431/67/10) | 406 (66/0/0/340) |
| bloqueador | 7 (7%) | 22 (22%) | 69 (70%) | 0 (0%) | 93% | 151 (63/49/35/4) | 138 (122/0/0/16) |
| paciente | 86 (61%) | 14 (10%) | 41 (29%) | 0 (0%) | 39% | 198 (42/11/131/14) | 181 (114/0/0/67) |
| variado | 19 (46%) | 6 (15%) | 16 (39%) | 0 (0%) | 54% | 106 (14/54/28/10) | 81 (48/0/0/33) |
| repetitivo | 35 (44%) | 13 (16%) | 31 (39%) | 0 (0%) | 56% | 136 (20/69/45/2) | 119 (85/0/9/25) |
| aleatorio | 10 (67%) | 3 (20%) | 2 (13%) | 0 (0%) | 33% | 76 (1/34/31/10) | 55 (24/0/0/31) |

Reading against the behavioural criteria: repetitivo, paciente (6%), aleatorio and data
sufficiency are fine; bloqueador starts 27% of its attacks into the enemy's swing (49 dodge
windows "missed" by its own attacks), so its attacks stand between it and its guard instead of
following it; agressivo has a LOWER cadence (47/min) than evasivo (56), repetitivo (53) and
bloqueador (49) because it spends 70% of its actions on the slow heavy weapon; agressivo,
aleatorio, variado and repetitivo have median runs under 20 s; the low-switch styles change
weapon far more often than their rate says (agressivo 2.1/min for a rate of 0.5, paciente 3.0
for 1, evasivo 3.3 for 2).

## Adjustments (in order, each with its behavioural reason)

### 1. policy.ts — weapon-switch rate fix (two causes) and a dash/lock fix

- **Stale-plan redraw.** A plan unused for 4 s forced a weapon redraw, so styles that wait
  (paciente) or are often busy redrew their weapon every 4 s. Now a stale plan redraws only the
  action; the weapon is forced only when no weighted action of the current weapon reaches the
  enemy from the current distance (the case the rule existed for: paciente holding a melee plan
  at range). Otherwise the weapon changes only at the style's rate.
- **Growing hazard.** The redraw probability used the time since the last *redraw* at every
  check, so the hazard grew at each check (a rate of 0.5/min redrew about every 14 s). It now
  uses the time since the previous *check*, which gives a true Poisson rate.
- **Dash inside a lock.** A dodge due during an action's locked phase is refused by the body, but
  the policy overwrote its own lock with the dash's 180 ms, so it could then send an attack the
  engine drops. It now keeps the longer lock. Before the fix this showed up in the existing
  FakeBody test as soon as the random sequence changed (one dropped `heavy_weapon.heavy`).
- Regression tests added in `policy.test.ts` (both fail on the old policy, pass on the new one):
  switches per style ≤ 1 + 1.5 × rate × minutes + 3 over 30 min in two worlds (old agressivo: 86
  for a bound of 26.5), and no dropped starts for agressivo/aleatorio/variado × 12 seeds in a
  cycle world (old: a dropped `heavy_weapon.heavy`).
- Effect (seed 1, styles unchanged): weapon changes/min agressivo 2.1 → 0.5, paciente 3.0 → 0.6,
  evasivo 3.3 → 0.8, variado 8.7 → 5.1. Side effect: evasivo now keeps its bow longer (bow 76% →
  85% of actions, 5 of 10 runs truncated) and variado sits on the bow for long stretches (bow
  47% of actions, above the 35% ceiling).

### 2. Styles, round 2

- **bloqueador `waitForOpening` false → true.** The spec says it guards, parries and
  *counter-attacks*; attacking on cooldown made it start 27% of its attacks into the enemy's
  swing. With the opening rule it attacks after the swing: attacks during the enemy's attack
  27% → 1%, dodge windows spoiled by its own attack 49 → 2, punish windows taken 122 → 132,
  block+parry still 93% of its labels, median run 22 → 25 s.
- **agressivo: weapon 0.6/0.4 → 0.7/0.3, `sword_shield.light` 3 → 4, `heavy_weapon.heavy` 2 → 1,
  cooldown 450 → 350 ms.** "Attacks a lot" must mean the highest cadence; the heavy weapon's
  long actions capped it. Cadence 49 → 59/min. Also tried `defenseWeights` none 0.85 → 0.7
  (dodge 0.2, block 0.1) for survival: no visible effect (agressivo is almost always inside its
  own action when the swing comes), see round 4.
- **variado: weapon weights 1/1/1 → 1/1.2/0.45.** Bow shots are the shortest action, so time on
  the bow turned into a large share of actions. Bow 47% → 25% of actions, max action share 25%.
- **aleatorio cooldown 600 → 800 ms** (to spend less time locked in actions and defend more):
  no improvement (median run 13.1 → 10.8 s, defence labels 15 → 21), reverted in round 3.

### 3. Styles, round 3

- **evasivo cooldown 700 → 900 ms**, to keep its bow cadence below agressivo's. Reverted later
  (round 5): it cut its punish data.
- **variado defence {dodge .3, block .3, parry .2, none .2} → {.35, .3, .25, .1}** and
  **repetitivo {dodge .3, block .3, none .4} → {.35, .35, none .3}**: their median runs were
  17–20 s; the spec does not fix their defence. Repetitivo 19.6 → 22.1 s; variado 17.2 → 20.1 s
  on seed 1 (but see the final table: it moves with the weapon mix).
- **agressivo none 0.7 → 0.6** (dodge 0.3): median run 12.2 → 12.9 s only. Not worth bending
  "almost does not defend".
- aleatorio cooldown back to 600 ms.

### 4. Styles, round 4

- **agressivo defence back to the original {dodge .1, block .05, none .85}.** Rounds 2–3 showed
  more defence weight buys it almost no survival (its defences mostly cannot execute because it
  is inside its own attacks), so the original "almost no defence" stays.
- Observed: variado back at bow 46% on this draw — single short runs keep one weapon for long.

### 5. Styles, round 5

- **variado bow 0.45 → 0.35 and `weaponSwitchPerMin` 8 → 15.** It "switches weapons and uses
  every action": more frequent redraws make the per-pilot mix follow the weights instead of one
  lucky draw. Max share 25%, bow 11%, 7.5 weapon changes/min.
- **agressivo cooldown 350 → 300 ms; evasivo weapon 0.75/0.25 → 0.7/0.3, cooldown 900 → 800.**
  Evasivo's valid punish windows had fallen to 16 (it is almost never within 45 px of a
  recovering enemy unless it closes in with the sword).
- On this draw agressivo got the heavy weapon for most of the session (80% of its actions):
  cadence 56/min vs evasivo 54, too close.

### 6. Styles, round 6

- **agressivo weapon 0.7/0.3 → 0.8/0.2**, so the sword (the fast weapon) is the usual draw:
  cadence 63/min.
- **evasivo weapon 0.7/0.3 → 0.65/0.35, cooldown 800 → 900**: valid punish windows 10 (seed 1)
  and 8 (seed 2) — below 15.

### 7. Styles, round 7 (final)

- **evasivo cooldown 900 → 700 ms (the original).** The cooldown, not the sword weight, is what
  makes evasivo engage: valid punish windows 35 (seed 1) / 38 (seed 2); bow 86% / 75% of its
  actions; cadence 59 / 56 per min, still below agressivo (63 / 61).

Unchanged from Task 4: paciente (all values), aleatorio (all values), bloqueador apart from
`waitForOpening`, repetitivo apart from its defence weights, every `preferredDistance`,
`distanceTolerance`, and the humanizer.

## Final values vs Task 4

| style | changed |
| --- | --- |
| agressivo | weapons sword 0.6 → 0.8, heavy 0.4 → 0.2; `sword_shield.light` 3 → 4; `heavy_weapon.heavy` 2 → 1; cooldown 450 → 300 ms |
| evasivo | weapons bow 0.75 → 0.65, sword 0.25 → 0.35 |
| bloqueador | `waitForOpening` false → true |
| paciente | — |
| variado | weapons 1/1/1 → sword 1, heavy 1.2, bow 0.35; `weaponSwitchPerMin` 8 → 15; defence {.3,.3,.2,.2} → {.35,.3,.25,.1} |
| repetitivo | defence {dodge .3, block .3, none .4} → {.35, .35, none .3} |
| aleatorio | — |
| policy.ts | stale plan keeps the weapon unless it cannot reach; Poisson switch hazard per check; a refused dash keeps the action lock |

## Final table — seed 1


### Runs, cadence, space, data

| style | compl | trunc | empty | mean run s | median run s | min run s | actions/min | weapon changes/min | M2 mean dist px | median dist px | mean dist while enemy attacks/recovers px | in melee (<=60px) | attacks w/ enemy attacking | enemy attacks/min | rooms/run | kills/death | max action gap s (median of runs) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| agressivo | 10 | 0 | 1 | 11.4 | 11.2 | 6.5 | 63.2 | 1.1 | 267.5 | 110.7 | 44.2 | 44% | 49% | 34.8 | 1.2 | 1.80 | 4.3 (3.0) |
| evasivo | 5 | 5 | 1 | 239.5 | 296.0 | 48.2 | 59.0 | 0.9 | 257.8 | 130.5 | 107.4 | 4% | 12% | 8.3 | 14.0 | 80.80 | 4.5 (3.9) |
| bloqueador | 10 | 0 | 1 | 24.3 | 25.1 | 18.4 | 39.1 | 0.0 | 177.5 | 48.4 | 50.5 | 66% | 1% | 45.5 | 1.7 | 2.80 | 4.8 (3.9) |
| paciente | 10 | 0 | 1 | 31.6 | 31.7 | 14.2 | 39.8 | 0.6 | 218.8 | 88.0 | 78.0 | 43% | 5% | 41.7 | 1.9 | 3.50 | 4.8 (3.5) |
| variado | 10 | 0 | 1 | 16.7 | 15.8 | 13.1 | 39.5 | 7.5 | 278.3 | 96.2 | 60.9 | 44% | 39% | 35.9 | 1.5 | 2.50 | 4.2 (3.8) |
| repetitivo | 10 | 0 | 1 | 20.3 | 22.1 | 8.7 | 49.6 | 0.0 | 215.8 | 59.8 | 58.2 | 50% | 30% | 40.8 | 1.5 | 2.30 | 4.3 (3.2) |
| aleatorio | 10 | 0 | 1 | 12.6 | 13.1 | 9.3 | 40.4 | 25.2 | 268.7 | 108.6 | 62.6 | 43% | 40% | 36.1 | 1.2 | 1.90 | 4.3 (3.4) |

### Executed actions per minute by action id (share of executed actions)

| style | sword_shield.light | sword_shield.heavy | sword_shield.charged | heavy_weapon.light | heavy_weapon.heavy | heavy_weapon.charged | bow.shot | max share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| agressivo | 27.9 (44%) | 19.0 (30%) | 4.7 (8%) | 9.5 (15%) | 2.1 (3%) | 0.0 (0%) | 0.0 (0%) | 44% |
| evasivo | 5.3 (9%) | 3.1 (5%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 50.5 (86%) | 86% |
| bloqueador | 28.4 (73%) | 10.6 (27%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 73% |
| paciente | 18.0 (45%) | 6.4 (16%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 15.4 (39%) | 45% |
| variado | 9.7 (25%) | 8.6 (22%) | 4.7 (12%) | 3.6 (9%) | 5.4 (14%) | 3.2 (8%) | 4.3 (11%) | 25% |
| repetitivo | 49.6 (100%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 100% |
| aleatorio | 6.7 (16%) | 7.1 (18%) | 4.3 (11%) | 4.8 (12%) | 8.1 (20%) | 4.8 (12%) | 4.8 (12%) | 20% |

### Executed actions per minute by weapon (share)

| style | sword_shield | bow | heavy_weapon |
| --- | --- | --- | --- |
| agressivo | 51.6 (82%) | 0.0 (0%) | 11.6 (18%) |
| evasivo | 8.4 (14%) | 50.5 (86%) | 0.0 (0%) |
| bloqueador | 39.1 (100%) | 0.0 (0%) | 0.0 (0%) |
| paciente | 24.5 (61%) | 15.4 (39%) | 0.0 (0%) |
| variado | 23.0 (58%) | 4.3 (11%) | 12.2 (31%) |
| repetitivo | 49.6 (100%) | 0.0 (0%) | 0.0 (0%) |
| aleatorio | 18.1 (45%) | 4.8 (12%) | 17.6 (44%) |

### obs.defense by label (count, share) and opportunities (valid = taken+missed+expired; invalid = out of range or interrupted)

| style | dodge | block | parry | retreat | block+parry share | dodge opp (taken/missed/expired/invalid) | punish opp (taken/missed/expired/invalid) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| agressivo | 6 (100%) | 0 (0%) | 0 (0%) | 0 (0%) | 0% | 59 valid, 66 total (1/43/15/7) | 42 valid, 46 total (34/0/8/4) |
| evasivo | 192 (94%) | 0 (0%) | 7 (3%) | 6 (3%) | 3% | 322 valid, 333 total (1/282/39/11) | 35 valid, 264 total (35/0/0/229) |
| bloqueador | 9 (7%) | 31 (24%) | 88 (69%) | 0 (0%) | 93% | 168 valid, 184 total (86/2/80/16) | 132 valid, 168 total (132/0/0/36) |
| paciente | 98 (62%) | 22 (14%) | 39 (25%) | 0 (0%) | 38% | 201 valid, 220 total (42/10/149/19) | 127 valid, 199 total (127/0/0/72) |
| variado | 16 (40%) | 3 (8%) | 21 (53%) | 0 (0%) | 60% | 89 valid, 100 total (18/43/28/11) | 48 valid, 80 total (48/0/0/32) |
| repetitivo | 41 (49%) | 18 (21%) | 25 (30%) | 0 (0%) | 51% | 133 valid, 138 total (19/51/63/5) | 99 valid, 124 total (92/0/7/25) |
| aleatorio | 10 (67%) | 3 (20%) | 2 (13%) | 0 (0%) | 33% | 66 valid, 76 total (1/34/31/10) | 24 valid, 55 total (24/0/0/31) |

## Robustness check — seed 2 (same final values)


### Runs, cadence, space, data

| style | compl | trunc | empty | mean run s | median run s | min run s | actions/min | weapon changes/min | M2 mean dist px | median dist px | mean dist while enemy attacks/recovers px | in melee (<=60px) | attacks w/ enemy attacking | enemy attacks/min | rooms/run | kills/death | max action gap s (median of runs) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| agressivo | 10 | 0 | 1 | 13.0 | 12.3 | 9.3 | 60.9 | 0.0 | 301.0 | 153.7 | 43.3 | 41% | 56% | 33.7 | 1.1 | 2.10 | 4.3 (3.4) |
| evasivo | 6 | 4 | 1 | 198.3 | 211.1 | 35.2 | 56.0 | 0.8 | 252.6 | 130.5 | 109.4 | 7% | 22% | 14.1 | 11.4 | 54.83 | 4.4 (4.1) |
| bloqueador | 10 | 0 | 1 | 27.2 | 28.2 | 12.7 | 36.4 | 0.0 | 233.6 | 48.8 | 50.3 | 61% | 0% | 41.7 | 1.8 | 2.90 | 6.8 (4.5) |
| paciente | 10 | 0 | 1 | 34.7 | 36.2 | 12.4 | 45.6 | 0.2 | 209.0 | 93.9 | 82.5 | 43% | 1% | 41.3 | 1.9 | 3.90 | 4.7 (3.5) |
| variado | 10 | 0 | 1 | 13.2 | 12.9 | 8.2 | 41.8 | 7.3 | 256.2 | 107.1 | 64.6 | 43% | 40% | 35.0 | 1.2 | 2.00 | 4.8 (3.0) |
| repetitivo | 10 | 0 | 1 | 16.9 | 13.8 | 9.8 | 52.7 | 0.0 | 190.9 | 52.3 | 55.9 | 54% | 34% | 43.1 | 1.2 | 1.90 | 4.1 (2.9) |
| aleatorio | 10 | 0 | 1 | 14.5 | 13.7 | 8.5 | 39.4 | 22.0 | 278.7 | 110.9 | 62.9 | 42% | 44% | 35.6 | 1.2 | 2.10 | 4.6 (3.5) |

### Executed actions per minute by action id (share of executed actions)

| style | sword_shield.light | sword_shield.heavy | sword_shield.charged | heavy_weapon.light | heavy_weapon.heavy | heavy_weapon.charged | bow.shot | max share |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| agressivo | 37.9 (62%) | 18.0 (30%) | 5.1 (8%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 62% |
| evasivo | 9.0 (16%) | 4.8 (9%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 42.2 (75%) | 75% |
| bloqueador | 28.2 (78%) | 8.2 (22%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 78% |
| paciente | 2.1 (5%) | 0.5 (1%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 43.0 (94%) | 94% |
| variado | 3.2 (8%) | 5.5 (13%) | 3.2 (8%) | 5.9 (14%) | 9.1 (22%) | 6.8 (16%) | 8.2 (20%) | 22% |
| repetitivo | 52.7 (100%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 0.0 (0%) | 100% |
| aleatorio | 5.4 (14%) | 5.0 (13%) | 5.0 (13%) | 5.8 (15%) | 7.9 (20%) | 4.1 (11%) | 6.2 (16%) | 20% |

### Executed actions per minute by weapon (share)

| style | sword_shield | bow | heavy_weapon |
| --- | --- | --- | --- |
| agressivo | 60.9 (100%) | 0.0 (0%) | 0.0 (0%) |
| evasivo | 13.9 (25%) | 42.2 (75%) | 0.0 (0%) |
| bloqueador | 36.4 (100%) | 0.0 (0%) | 0.0 (0%) |
| paciente | 2.6 (6%) | 43.0 (94%) | 0.0 (0%) |
| variado | 11.8 (28%) | 8.2 (20%) | 21.8 (52%) |
| repetitivo | 52.7 (100%) | 0.0 (0%) | 0.0 (0%) |
| aleatorio | 15.3 (39%) | 6.2 (16%) | 17.8 (45%) |

### obs.defense by label (count, share) and opportunities (valid = taken+missed+expired; invalid = out of range or interrupted)

| style | dodge | block | parry | retreat | block+parry share | dodge opp (taken/missed/expired/invalid) | punish opp (taken/missed/expired/invalid) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| agressivo | 7 (78%) | 0 (0%) | 2 (22%) | 0 (0%) | 22% | 67 valid, 73 total (1/55/11/6) | 46 valid, 49 total (33/0/13/3) |
| evasivo | 279 (92%) | 0 (0%) | 15 (5%) | 8 (3%) | 5% | 458 valid, 467 total (1/398/59/9) | 38 valid, 370 total (38/0/0/332) |
| bloqueador | 10 (7%) | 40 (30%) | 84 (63%) | 0 (0%) | 93% | 174 valid, 189 total (84/0/90/15) | 136 valid, 174 total (136/0/0/38) |
| paciente | 107 (57%) | 37 (20%) | 43 (23%) | 0 (0%) | 43% | 227 valid, 239 total (42/2/183/12) | 208 valid, 227 total (208/0/0/19) |
| variado | 13 (65%) | 1 (5%) | 6 (30%) | 0 (0%) | 35% | 72 valid, 77 total (5/37/30/5) | 33 valid, 60 total (33/0/0/27) |
| repetitivo | 30 (45%) | 13 (20%) | 23 (35%) | 0 (0%) | 55% | 114 valid, 121 total (17/51/46/7) | 87 valid, 106 total (80/0/7/19) |
| aleatorio | 16 (64%) | 1 (4%) | 8 (32%) | 0 (0%) | 36% | 79 valid, 86 total (9/41/29/7) | 35 valid, 65 total (35/0/0/30) |

## Behavioural acceptance (final values, seed 1 / seed 2)

| criterion | result |
| --- | --- |
| repetitivo: 100% `sword_shield.light`, no switch | met (100% / 100%, 0 changes) |
| variado: 3 weapons, ≥ 5 of 7 ids, no id > 35% | met (7/7 ids both seeds; max share 25% / 22%) |
| bloqueador: block+parry majority, counters after defending | met (93% / 93%; attacks during the enemy's swing 1% / 0%; punish taken 132 / 136) |
| evasivo: bow ≥ 50% | met (86% / 75%) |
| evasivo: clearly larger mean distance than agressivo | **met on the exchange, not on M2.** Distance while the enemy attacks/recovers 107 vs 44 px (seed 1), 109 vs 43 (seed 2); time in melee 4% vs 44%, 7% vs 41%. But M2 (time-weighted mean) is 258 vs 268 and 253 vs 301, and the median is 131 vs 111 / 131 vs 154 — see Observations. |
| evasivo: ≥ 15 dodge opportunities | met (322 / 458 valid) |
| agressivo: highest attack cadence | met (63.2 vs next 59.0 evasivo; 60.9 vs 56.0) — margin about 7% |
| paciente: < 10% of attacks during the enemy's attack | met (5% / 1%) |
| aleatorio: each of the 7 actions 8–20% | met (11–20% / 11–20%; the top category sits at the 20% edge on both seeds) |
| aleatorio: defensive choices roughly uniform | choices are uniform by construction (0.25 each); the *labels* are not (dodge 67% / 64%, block 20% / 4%, parry 13% / 32%) and are few (15 / 25 labels) — see Observations |
| (b) ≥ 8 completed-or-truncated runs of 10 | met (10/10 for every agent) |
| (b) ≥ 15 punish and ≥ 15 dodge opportunities | met (smallest valid punish: aleatorio 24 / evasivo 35 on seed 1; smallest dodge: aleatorio 66) |
| (c) median run ≥ 20 s | **not met** for agressivo (11.2 / 12.3 s), variado (15.8 / 12.9), aleatorio (13.1 / 13.7), and repetitivo on seed 2 (22.1 / 13.8). Met for evasivo, bloqueador, paciente. No agent dies in seconds: shortest single run 6.5 s (agressivo), every agent kills ≥ 1.8 enemies per death. |
| (d) no deadlock / stall | met: the longest stretch without an executed action is 4.1–6.8 s (it includes the walk-in to a new enemy spawned ≥ 300 px away); every run either ends in death or reaches the cap. |

Why (c) was not forced: the melee styles stand inside the enemy's 60 px range with a 250 ms
reaction; an undefended hit is 20 of 100 HP, and the enemy attacks about every 1.05 s while in
range, so ~5 hits land in 10–15 s. Rounds 2–3 showed that adding defence weight to agressivo
buys almost nothing (it is inside its own attacks when the swing comes), and making agressivo,
variado or aleatorio defend much more would contradict "almost does not defend" / "uniform
control". The runs are short but carry data (≥ 24 valid punish and ≥ 59 valid dodge windows per
agent in 10 runs). This is left to the author.

## Observations for the report (not tuned)

- **Distance (M2) is dominated by the walk-in, not by the style.** Every encounter starts with
  the enemy spawned ≥ 300 px away (up to ~1400 px across the arena). Agents that die or kill
  fast spend a larger share of their time walking in, so agressivo's time-weighted mean (268 /
  301 px) is *larger* than evasivo's (258 / 253) although evasivo spends 4–7% of its time in
  melee and agressivo 41–44%. Only the distance during the exchange (enemy attacking or
  recovering) separates them clearly (43–44 vs 107–109 px). If the operational-distance dimension
  (H7, H8) averages over all samples, it inherits this confound. Not tuned: no style was changed
  to move M2.
- **Patience barely discriminates among the waiting styles.** In raw behaviour paciente (5% / 1%
  of its attacks during the enemy's swing), bloqueador (1% / 0%, after `waitForOpening`) and
  evasivo (12% / 22%, mostly bow shots from range, which the game treats as safe) are all
  "patient"; with the bloqueador change this is even more so. Only agressivo (49% / 56%),
  variado, repetitivo and aleatorio (30–44%) attack into the swing. H9–H11 compare paciente with
  agressivo/aleatorio and evasivo with agressivo, so they are not affected, but the dimension
  will not separate paciente from bloqueador or evasivo. Not tuned.
- **Evasivo's dodge windows are almost all "missed", not "taken".** The game closes a dodge
  window as `missed` when the player executes any action while the enemy is attacking, even a
  bow shot from 130 px. Evasivo dodges 92–94% of its labelled attacks but shows 1 taken vs 282 /
  398 missed. Dodges are also triggered at ~250 ms while the hit lands at 400 ms, after the
  150 ms i-frames, so "taken" (an i-frame dodge) is rare for every style. Not tuned.
- **Evasivo's punish windows are mostly invalid** (out of range: 229 / 332 invalid vs 35 / 38
  valid). Its punish data comes from the few sword exchanges.
- **Defence labels are outcomes, not choices.** Aleatorio chooses dodge/block/parry/none
  uniformly, but its labels are few (15 / 25 in 76 / 86 enemy attacks) and dodge-heavy:
  blocks only start from idle, so a block chosen while it is inside an action comes too late
  and the hit is unmitigated (no label); a block raised late enough is labelled parry. Agressivo
  has 6 / 9 labels in total. The defensive repertoire of these two agents rests on little data
  per run.
- **Low-switch styles keep one weapon per session.** With the corrected Poisson rate, paciente
  (1/min) used the bow for 94% of its actions on seed 2 and 39% on seed 1; agressivo was all
  sword on seed 2. The weapon mix of these styles varies between sessions much more than the
  weights suggest.
- **Evasivo truncates often** (5 / 4 of 10 runs reach the 300 s cap): it outruns the enemy
  (220 vs 125 px/s), as the Task 4/5 reports predicted.
