# Estimating an Energy Curve from sleep

Researched on 28 November 2026 for the Energy Curve on the timeline rail (#88, `docs/design/timeline.md`). Inputs are the Oura data already synced (sleep start and end, minutes asleep, sleep score, readiness score, recommended bedtime window) and Avi's Usual Wake (median wake time over his last 14 nights). There is no heart rate, HRV, caffeine, food, naps or exercise.

## Verdict

1. **Build a small two-process model, not a lookup.** Alertness is a circadian term (Process C) minus a sleep pressure term (Process S), plus a short sleep inertia dip after waking. This is the structure behind Borbély's two-process model and Åkerstedt and Folkard's three-process model, and it needs only sleep times as input. It fits what LifeOS has.
2. **Anchor the shape on wake time and call it an estimate.** The late-morning peak, the post-lunch dip and the early evening second wind are population-average features. LifeOS places them relative to Usual Wake (or last night's real wake for today). It cannot know how Avi feels.
3. **Use sleep to scale the whole curve.** A short night lowers the level and deepens the dip. A run of short nights (sleep debt over 14 nights) lowers it further, because restriction has a cumulative cost that one good night does not clear (Van Dongen 2003). Readiness nudges the level only slightly.
4. **Several numbers are LifeOS choices.** The S time constants, inertia time constant, sleep need, short night threshold and the wake-relative placement of the peaks are design parameters. The papers opened here support the structure, not these exact values. The table says which is which.
5. **Draw it, never quote it.** No numbers, no "energy score", no health claims. The curve is a shape with an Estimate label.

## 1. The model

Energy at time `t` (hours since wake), before scaling:

`A(t) = 0.3 * cos(2π(t - 9.4) / 24) + 0.24 * cos(4π(t - 1.9) / 24) - S(t) - 0.45 * e^(-t / 0.8)`

`S(t) = 1 - (1 - S0) * e^(-t / 18.2)`, and `S0 = Sbed * e^(-asleep / 4.2)`, where `Sbed` is the steady bedtime pressure of a 16 h day and an 8 h night (about 0.62).

The level is `clamp01( (A(t) - low) / (high - low) * q )`, where `low` and `high` are the lowest and highest `A` of a reference day after 8 h asleep, so every day is drawn on the same scale and a short night really sits lower. `q` is the sleep factor below. This lives in `energyDay` in `packages/backend/convex/health/energy.ts`.

- **Process S.** Sleep pressure rises as a saturating exponential while awake and falls exponentially in sleep. Borbély (1982) fitted the fall in sleep to the decline of slow wave activity and drew the daytime rise as a saturating exponential that was "not yet based on empirical data" (Borbély 2022, a retrospective by the model's author). LifeOS starts S for the day from last night's sleep: a full night leaves S near its floor, a short night leaves it higher.
- **Process C.** A roughly 24 h sine, with its phase set by the circadian pacemaker (Borbély 1982 used vigilance data from prolonged wakefulness). Alertness is high when C is high and S is low. Dijk and Czeisler (1994) found the two processes contribute about equally to consolidated sleep and wake, and their timing across the day is arranged so wake stays consolidated through the evening.
- **12 h harmonic.** Monk (2005) reports a post-lunch dip in performance that occurs "even when the individual has had no lunch", with roots in biology that "may be linked to the size of the 12-hour harmonic in the circadian system". LifeOS adds a 12 h cosine whose trough sits in the early afternoon. A big lunch only exaggerates it, and LifeOS does not know about lunch.
- **Sleep inertia.** After waking, alertness starts low and recovers. LifeOS uses a decaying exponential. The three-process model adds this as a third term (Process W). The abstracts opened do not give its parameters.
- **Second wind.** The 24 h plus 12 h sum already produces a rise in the early evening, a few hours before habitual bedtime. This matches the "wake maintenance" period of strong wake drive just before the melatonin rise. LifeOS draws it as a gentler bump, then falls to the wind down towards Oura's recommended bedtime.
- **Scaling by sleep.** A short night does two things. It leaves more pressure at wake (`S0`), which lowers the whole day a little. And the sleep factor `q = 1 - 0.3 * short - 0.15 * debt + readiness` multiplies the curve: `short` is the shortfall below 8 h over 4 h (0 to 1), `debt` is the 14 night debt over 15 h (0 to 1), and readiness adds `(readiness - 75) / 250`, held between -0.1 and +0.06. `q` stays between 0.4 and 1. The sleep score is not used, because it mostly restates duration and readiness.

| Name | Value | Source |
| --- | --- | --- |
| S rise time constant (awake) | 18.2 h | Standard published fit for the two-process model. **Not verified in a source opened for this note** |
| S decay time constant (asleep) | 4.2 h | Same. **Not verified in a source opened for this note** |
| S form | Saturating exponential up, exponential down | Borbély 1982; Borbély et al. 2016 (abstract) |
| Process C period | 24 h sine | Borbély 1982 |
| C anchor | Acrophase 9 to 10 h after wake | **LifeOS choice.** The three-process model places C by clock time, not by wake (see "Where the sources disagree") |
| Post-lunch dip harmonic | 12 h cosine, trough 7 to 8 h after wake (about 13:00 to 16:00 for a 07:00 waker) | Monk 2005 gives the 12 h harmonic. The wake-relative trough is **a LifeOS choice** from the usual 13:00 to 16:00 window |
| Sleep inertia time constant | About 0.8 h (fades over 1 to 2 h) | Three-process model includes inertia. The 0.8 h value is **a LifeOS choice** |
| Sleep need | 8 h | **LifeOS choice.** RISE uses a personal need estimate, from 5 h to 11 h 30 min across its users |
| Sleep debt window | 14 nights, weighted towards recent nights | Window matches RISE and the 14 day study of Van Dongen 2003. The weights are **a LifeOS choice** |
| Rhythm amplitudes | 0.3 (24 h), 0.24 (12 h) | **LifeOS choice**, tuned so the evening second wind stays below the late-morning peak, as in the approved design |
| Low energy day | Under 6 h asleep, or a sleep factor `q` under 0.75 | **LifeOS choice** |
| Minimum history | 5 nights | **LifeOS choice** |
| Grid | 15 minutes, wake to bedtime, level 0 to 1 | LifeOS design |

Debt per night is `max(0, need - asleep)`. The weight of the `n`th most recent recorded night is `(14 - n) / 14` (a LifeOS choice), so last night counts fully and the fourteenth night counts a fourteenth. Debt is the weighted sum, in minutes. Ten minutes short every night for 14 nights is 75 minutes of debt.

Today uses last night's real sleep, real wake and readiness. Coming days use the Usual Wake, the median recent sleep duration, no readiness, and the debt as it stands today. A coming day is always drawn hatched as a prediction.

Checked against Avi's 14 recorded nights from 13 to 27 November 2026 (read only, not saved): waking around 8:00, the peak lands about 10:15 to 11:30 and the dip about 15:00 to 16:45. The two nights under about 6 h (23 and 25 November) are the only Low energy days. After a 9.5 h night with a 10:46 wake (26 November) the curve sits high and late: peak 13:00 to 14:00, dip 18:00 to 19:30. His debt against an 8 h need is about 8 h, so most days draw a little below the top of the scale.

## 2. What it can claim and what it cannot

**It can claim:**

- A typical shape of the day for someone who woke at this time and slept this long.
- That a short or debt-laden run of nights is associated with lower alertness. Van Dongen et al. (2003) found that restricting sleep to 6 h a night for 14 days produced performance deficits that grew each day, ending up about as bad as one to two nights of total sleep deprivation (the abstract states the cumulative, dose-dependent deficit; the equivalence is in the full text, which was not opened).
- That a post-lunch dip exists in many people even without lunch (Monk 2005).

**It cannot claim:**

- How Avi feels. Nothing measures it. The curve is a population-average shape placed on his wake time.
- Any effect of caffeine, food, naps, exercise, illness, stress, alcohol, light or travel. None are inputs.
- That the dip or peak will happen at the drawn time. Monk (2005) says the dip occurs "for some performance variables, and some individuals". Individuals vary in timing and in size.
- Anything about melatonin, circadian phase or chronotype. LifeOS has no melatonin or temperature data, so it makes no such claim. The wake-anchored phase is a convenience.
- That the number of hours of debt is medically meaningful. Belenky et al. (2003) found that with 5 to 7 h in bed, performance stabilised at a reduced level, with no sign of recovery for those groups over the three recovery nights. People may adapt without feeling worse, so a debt figure should not be treated as a diagnosis.

**Product rules that follow:**

- Label the curve "Estimate" everywhere it appears.
- Show no energy numbers, scores or percentages. Show shape only.
- "Low energy day" is a plain flag for a short night or high debt, never a warning about health.
- With fewer than five nights, or no Oura, draw nothing.
- Never suggest sleep or medical action from the curve.

## 3. Where the sources disagree with the starting values

- **C anchor.** Åkerstedt and Folkard (1996) fitted the circadian component with an acrophase set by clock time, 20:48 for predicting sleep latency, which is far later than 9 to 10 h after a morning wake. That fit is for sleep onset, not daytime alertness, so LifeOS keeps its wake-anchored daytime peak as a deliberate choice. Treat it as a tunable.
- **S time constants and inertia.** The 18.2 h and 4.2 h values could not be confirmed from the pages opened. The inertia abstracts give no parameter at all. Both stay as LifeOS choices until checked against the full papers.
- **Dip timing.** The Monk abstract confirms the 12 h harmonic but does not state "7 to 8 h after wake" or "13:00 to 16:00". Those are from general knowledge, not a page opened here.

## Sources

Opened in full or as an abstract on 28 November 2026. "Abstract only" means the full text was not read.

1. Borbély AA (1982). A two process model of sleep regulation. *Human Neurobiology* 1(3), 195 to 204. Not opened: Europe PMC lists it (PMID 7185792) with no abstract. Its content is taken from source 3. https://pubmed.ncbi.nlm.nih.gov/7185792/
2. Borbély AA, Daan S, Wirz-Justice A, Deboer T (2016). The two-process model of sleep regulation: a reappraisal. *Journal of Sleep Research* 25(2), 131 to 143. Abstract only. https://doi.org/10.1111/jsr.12371
3. Borbély AA (2022). The two-process model of sleep regulation: Beginnings and outlook. *Journal of Sleep Research* 31(4), e13598. Full text via Europe PMC. https://doi.org/10.1111/jsr.13598
4. Åkerstedt T, Folkard S (1995). Validation of the S and C components of the three-process model of alertness regulation. *Sleep* 18(1), 1 to 6. Abstract only. https://doi.org/10.1093/sleep/18.1.1
5. Åkerstedt T, Folkard S (1996). Predicting sleep latency from the three-process model of alertness regulation. *Psychophysiology* 33(4), 385 to 389. Abstract only. https://doi.org/10.1111/j.1469-8986.1996.tb01063.x
6. Åkerstedt T, Folkard S (1997). The three-process model of alertness and its extension to performance, sleep latency, and sleep length. *Chronobiology International* 14(2), 115 to 123. Abstract only. https://doi.org/10.3109/07420529709001149
7. Åkerstedt T, Ingre M, Kecklund G, Folkard S, Axelsson J (2008). Accounting for partial sleep deprivation and cumulative sleepiness in the Three-Process Model of alertness regulation. *Chronobiology International* 25(2 to 3), 309 to 319. Abstract only. https://doi.org/10.1080/07420520802110613
8. Monk TH (2005). The post-lunch dip in performance. *Clinics in Sports Medicine* 24(2), e15 to e23. Abstract only. https://doi.org/10.1016/j.csm.2004.12.002
9. Van Dongen HPA, Maislin G, Mullington JM, Dinges DF (2003). The cumulative cost of additional wakefulness: dose-response effects on neurobehavioral functions and sleep physiology from chronic sleep restriction and total sleep deprivation. *Sleep* 26(2), 117 to 126. Abstract only. https://doi.org/10.1093/sleep/26.2.117
10. Belenky G, Wesensten NJ, Thorne DR, et al. (2003). Patterns of performance degradation and restoration during sleep restriction and subsequent recovery: a sleep dose-response study. *Journal of Sleep Research* 12(1), 1 to 12. Abstract only. https://doi.org/10.1046/j.1365-2869.2003.00337.x
11. Dijk DJ, Czeisler CA (1994). Paradoxical timing of the circadian rhythm of sleep propensity serves to consolidate sleep and wakefulness in humans. *Neuroscience Letters* 166(1), 63 to 68. Abstract only. https://doi.org/10.1016/0304-3940(94)90841-9
12. RISE Science. Is the RISE sleep app worth it? (sleep debt over 14 nights, personal sleep need, energy schedule built on the SAFTE model). First-party page. https://www.risescience.com/blog/is-the-rise-sleep-app-worth-it

Not opened (left out of the model claims): Lavie's "forbidden zone for sleep" and Strogatz's work, Dijk and Czeisler 1995, Åkerstedt, Folkard and Portin 2004, Oura's readiness documentation, RISE's help centre (blocked).
