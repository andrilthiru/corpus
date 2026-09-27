"""
Finalised Tamil error detection for the corpus app (prototype freeze, v4).

Evidence and decisions come from the research pipeline (tamil_pipeline.py = Tamil_Error_Pipeline v3.1),
benchmarked on QA1 / QA2 / clean texts. The frozen design:

  positive validity   Hunspell ta_IN + wordfreq + ThamizhiMorph + names list  (never an error verdict)
  candidate sources   Tamil rules · lexical neighbour · TamilVU (ஒற்று only) · Vaani (optional) · MuRIL (margin 4.0)
  who reaches the annotator
      1. mechanical rules (repeated punctuation, repeated word)             → shown
      2. two independent evidence families agree                           → shown
      3. everything else (incl. contextual rules: agreement, case, tense,
         sandhi, construction …) → Sarvam answers "is this really an error
         in this sentence?"  yes → shown · no → hidden
      If Sarvam is unavailable, contextual rules are still shown (marked unverified);
      single weak sources stay hidden.
  Nothing is auto-corrected. Open-ended AI "find everything" is only run on request.
"""
from __future__ import annotations

import os
import threading
import time

import tamil_pipeline as P

RES = os.getenv("TAMIL_RESOURCES", "/opt/tamil")
MECHANICAL = {"PUNCT", "EXTRA"}          # rules_generic subtypes that are deterministic
MLM_BUDGET_S = float(os.getenv("MLM_BUDGET_SECONDS", "75"))
ENGINE_NAME = {"rules_generic": "rules", "lexical_neighbour": "lexicon", "tamilvu": "tamilvu",
               "vaani": "vaani", "confusable_mlm": "muril"}

_lock = threading.Lock()
_lex = None
_cfg = None


def _has_torch() -> bool:
    try:
        import torch  # noqa: F401
        import transformers  # noqa: F401
        return os.getenv("DISABLE_MURIL", "0") != "1"
    except Exception:
        return False


def config() -> "P.Config":
    global _cfg
    if _cfg is None:
        _cfg = P.Config(
            run_rules=True, run_neighbour=True,
            run_vaani=os.getenv("DISABLE_VAANI", "0") != "1", vaani_timeout=int(os.getenv("VAANI_TIMEOUT", "8")),
            run_mlm=False,                        # run separately below, with a time budget
            run_tamilvu=True, tamilvu_mode="sandhi",
            run_llm_verifier=False,
            use_names=True, mlm_strict=True, mlm_margin=4.0, mlm_models=("google/muril-base-cased",),
            hunspell_dict_dir=os.path.join(RES, "dict"), morph_dir=os.path.join(RES, "FST-Models"),
            llm_provider="sarvam", sarvam_reasoning_effort=None, llm_max_tokens=8000,
            names_path=os.getenv("TAMIL_NAMES_PATH") or None,
        )
    return _cfg


def lexicon() -> "P.LexiconGate":
    global _lex
    if _lex is None:
        _lex = P.LexiconGate(config())
    return _lex


def status() -> dict:
    lex = lexicon()
    try:
        import tamilinayavaani  # noqa: F401
        tvu = True
    except Exception:
        tvu = False
    return {"hunspell": lex.hunspell_ok, "morphology": bool(lex.morph and lex.morph.ok),
            "wordfreq": lex._zipf_fn is not None, "tamilvu": tvu, "muril": _has_torch(),
            "sarvam": bool(os.getenv("SARVAM_API_KEY"))}


def _budgeted_scorer(deadline):
    def scorer(sent, s, e, cand):
        if time.time() > deadline:
            return -1e9                          # out of time: no candidate can beat the original
        return P.mlm_window_score(sent, s, e, cand, config())
    return scorer


def _families(detected_by: str) -> set:
    return P.families(detected_by) - {"llm"}


def _frontend(row: dict, reason: str, verdict: dict | None, text: str) -> dict:
    srcs = [s for s in row["detected_by"].split("+") if s]
    engines = [ENGINE_NAME.get(s, s) for s in srcs]
    correction = row.get("suggested_correction") or ""
    subtype = row.get("subtype")
    if verdict and verdict.get("is_error"):
        engines.append("sarvam")
        correction = verdict.get("correction") or correction
        if verdict.get("subtype") in P.SUBTYPES:
            subtype = verdict["subtype"]
    evidence = []
    for ev in row.get("evidence") or []:
        evidence.append({"engines": [ENGINE_NAME.get(ev.get("source"), ev.get("source"))],
                         "suggested_correction": ev.get("correction") or "",
                         "subtype": ev.get("subtype"), "note": ev.get("note") or ""})
    if verdict:
        evidence.append({"engines": ["sarvam"], "suggested_correction": verdict.get("correction") or "",
                         "subtype": verdict.get("subtype") or None,
                         "note": ("confirmed: " if verdict.get("is_error") else "rejected: ") + (verdict.get("reason") or "")})
    label = {"mechanical_rule": "Rule (certain)", "agreement": "Two independent checks agree",
             "ai_confirmed": "Confirmed by Sarvam", "unverified_rule": "Tamil rule · AI check unavailable"}[reason]
    return {
        "learner_form": row["error_text"], "start": row["start"], "end": row["end"],
        "suggested_correction": correction, "subtype": subtype,
        "note": f"{label}. " + (row.get("note") or ""),
        "engines": engines, "evidence": evidence,
        "agreement": len(_families(row["detected_by"])) >= 2,
        "tier": "likely", "gate_reason": reason,
    }


def detect(text: str) -> dict:
    """Returns {'candidates': [...frontend candidates...], 'engines': {...}, 'suppressed': n}."""
    cfg = config()
    engines = {}
    with _lock:                                  # the lexicon caches and FST calls are not thread-safe
        lex = lexicon()
        t0 = time.time()
        run = P.run_pipeline(text, cfg, verbose=False, lexicon=lex)
        for name, cands in run["per_tool"].items():
            engines[ENGINE_NAME.get(name, name)] = {"ok": True, "count": len(cands),
                                                   "seconds": round(run["runtimes"].get(name, 0), 1)}
        # MuRIL: real-word errors (வாலை/வாழை, மனம்/மணம்) — strict, margin 4.0, time-boxed
        if _has_torch():
            t1 = time.time()
            try:
                deadline = t1 + MLM_BUDGET_S
                mlm = P.tool_mlm(run["text"], lex, cfg, scorer=_budgeted_scorer(deadline))
                engines["muril"] = {"ok": True, "count": len(mlm), "seconds": round(time.time() - t1, 1),
                                    **({"note": "time limit reached; partial"} if time.time() > deadline else {})}
                run["per_tool"]["confusable_mlm"] = mlm
                run["candidates"] = P.to_rows(P.merge_sources(run["text"], *run["per_tool"].values()))
            except Exception as exc:
                engines["muril"] = {"ok": False, "error": str(exc)[:300]}
        else:
            engines["muril"] = {"ok": False, "error": "not installed on this server"}

    rows = run["candidates"]
    shown, need = [], []
    for r in rows:
        srcs = set(r["detected_by"].split("+"))
        if "rules_generic" in srcs and r.get("subtype") in MECHANICAL:
            shown.append((r, "mechanical_rule", None))
        elif len(_families(r["detected_by"])) >= 2:
            shown.append((r, "agreement", None))
        else:
            need.append(r)

    verdicts, sarvam_ok = {}, False
    if need:
        t2 = time.time()
        try:
            verdicts = P.llm_verify_candidates({**run, "candidates": need}, cfg, only_unconfirmed=False, label="app")
            sarvam_ok = True
            engines["sarvam"] = {"ok": True, "asked": len(need), "confirmed": sum(1 for v in verdicts.values() if v["is_error"]),
                                 "seconds": round(time.time() - t2, 1), "role": "verifier"}
        except Exception as exc:
            engines["sarvam"] = {"ok": False, "error": str(exc)[:300], "role": "verifier"}
    suppressed = 0
    for r in need:
        v = verdicts.get(r["candidate_id"])
        if v and v["is_error"]:
            shown.append((r, "ai_confirmed", v))
        elif not sarvam_ok and "rules_generic" in r["detected_by"].split("+"):
            shown.append((r, "unverified_rule", None))
        else:
            suppressed += 1
    shown.sort(key=lambda x: x[0]["start"])
    return {"candidates": [_frontend(r, why, v, run["text"]) for r, why, v in shown],
            "engines": engines, "suppressed": suppressed, "seconds": round(time.time() - t0, 1),
            "text": run["text"]}
