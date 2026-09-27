# v0.18: Insights → ✦ Intelligence

A new first tab under Insights, in three layers.

1. **Findings:**
   - **Key findings**, written in plain language, each with its evidence.
   - **Grow out of / persistent / increasing** for every error type across levels.
   - **Errors that travel together:** partial correlation after allowing for level, script length and overall accuracy.
2. **Diagnosis:**
   - **Learner progress:** the same pseudonymous learner code followed over time.
   - **Schools:** rates with 95% intervals, and where a school stands out.
   - **Writing quality:** script length and vocabulary richness against error rate, plus error groups by richness quartile.
   - **Prompts & tasks:** which prompts and tasks trigger which errors.
3. **Action:**
   - **Teaching priorities** per level: frequency × reach × persistence, with a teaching tip and learner examples.
   - **Ask the corpus:** Sarvam answers questions from the aggregate statistics only. No learner text is sent.

## Statistics
- Rates are per 100 words, with Poisson 95% intervals.
- Comparisons are rate ratios with 95% intervals. A finding is only reported when the interval clears a threshold, with at least 8 scripts and 8 errors.
- Computing everything takes about 0.2 s for 1,200 scripts and about 0.5 s for 5,000, in the browser.

## Data source
- The toggle switches between **corpus data** and a **simulated demo** of 1,201 scripts, generated from a fixed seed. The simulated data is clearly labelled.
- The simulation has known patterns built in, and the engine finds them:
  - school SCH-C has about 2.2× the ல/ள/ழ errors
  - ஒற்று errors stay flat across levels
  - narrative scripts have more tense errors
  - formal emails have more person/number/gender errors
  - ல/ள/ழ, ந/ன/ண and ர/ற errors move together
- The view defaults to corpus data once there are 30 or more real scripts.

## Server
- New endpoint `POST /api/ask-corpus` on the OCR service; the version number becomes 0.18.0.
- Redeploy with the usual `gcloud run deploy corpus-ocr --source ./backend …` command.
