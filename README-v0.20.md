# v0.20: annotation step fixes from testing

**Stage 4 (error annotation)**
- **Missing words.** Click between two words and choose **+ Missing word here**. You can also select a word and choose **+ Missing word after**. This adds a card of type சொல் விடுபட்ட பிழை (Missing word): type the word to add, then Accept. A caret marks the gap in the original text, and the corrected text shows the added word. If the transcript is edited later, the card is re-anchored by the words around the gap.
- **Transcript edits reach Stage 4.** Stage 4 now shows every included line in its current form. Previously it showed only lines already marked reviewed, so an edit on a line that still had an open item didn't appear. A note tells you how many lines are still open in step 3.
- **Reviewed cards leave the list.** The card list opens on **To review**. Accepting or rejecting a card removes it and moves to the next one. Reviewed cards are still under All, Accepted and Rejected.
- **Delete.** Cards you added yourself have a Delete button.
- **Accept check.** Accept is blocked when the correction is the same as the learner's text, or when a missing-word card is still empty.
- **Automatic detection.** Detection runs by itself when you open the step. It runs again when you come back after changing the transcript. Accepted and rejected decisions and your own cards are kept.
- **"Ask AI for more" status.** The status line now shows which AI answered, which did not, and how many suggestions already had a card.

**Backend 0.20.0**
- **Gemini replies.** Gemini's discovery reply was being cut off: Gemini 2.5's internal reasoning used up the 1,800-token output limit, so only Sarvam's suggestions ever arrived. Reasoning is now off for this call, the limit is 8,192, and complete items from a cut-off reply are kept.
- **Parallel requests.** Sarvam and Gemini are now asked at the same time.

## Detection changes matched to the v3.1 test results
- **"Ask AI for more" now includes GPT** (`gpt-5`, the model tested). It asks GPT, Sarvam and Gemini at the same time; a model that isn't configured is skipped and named in the status line. In the benchmark, GPT's open search found 23/23 and 22/22 known errors (Sarvam 18/23 and 3/22; Gemini untested).
  - Needs a pay-as-you-go OpenAI API key set on the Cloud Run service as `OPENAI_API_KEY` (optional: `OPENAI_MODEL`).
- **TamilVU no longer chooses the correction.** When MuRIL, the rules or the dictionary neighbour proposed a correction for the same word, theirs is used, and the error type follows it (வேளை → வேலை, ல/ள/ழ; not வேளைச், ஒற்று). In testing TamilVU on its own produced only false flags.
