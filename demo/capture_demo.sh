#!/usr/bin/env bash
# Records real responses from the corpus service for the walkthrough video and user guide.
# Usage (Cloud Shell, after uploading the scan):   bash ~/corpus/demo/capture_demo.sh ~/Story1_page1.pdf
set -euo pipefail
URL="${URL:-https://corpus-ocr-970342682197.asia-southeast1.run.app}"
PDF="${1:?Usage: bash capture_demo.sh path/to/Story1_page1.pdf}"
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HOME/demo_capture"; rm -rf "$OUT"; mkdir -p "$OUT"

echo "1/5 page count…"
curl -sS -X POST "$URL/api/page-count" -F "file=@${PDF};filename=scan.pdf" > "$OUT/pagecount.json"
echo "2/5 recognising page 1 (about 1 minute)…"
curl -sS -X POST "$URL/api/transcribe-page" -F "file=@${PDF};filename=scan.pdf" -F page_number=1 \
  -F document_id=DEMO-001 -F source_type=handwritten > "$OUT/transcribe_p1.json"

# learner text = recognised lines that contain Tamil (letterhead / ID lines are left out, as in review)
python3 - "$OUT" <<'PY'
import json, re, sys
out = sys.argv[1]
d = json.load(open(f"{out}/transcribe_p1.json", encoding="utf-8"))
lines = []
for l in d.get("lines", []):
    t = (l.get("primary_ocr") or {}).get("raw_text") or ""
    tamil = len(re.findall(r"[஀-௿]", t)); latin = len(re.findall(r"[A-Za-z0-9]", t))
    if tamil >= 3 and latin <= tamil * 0.3:
        lines.append(t.strip())
json.dump({"text": "\n".join(lines), "level": "P6", "task": "Composition", "mode": "standard"},
          open(f"{out}/detect_request.json", "w", encoding="utf-8"), ensure_ascii=False)
print("  learner lines:", len(lines))
PY
echo "3/5 error detection…"
curl -sS -X POST "$URL/api/detect-errors" -H "Content-Type: application/json" --data-binary @"$OUT/detect_request.json" > "$OUT/detect.json"
python3 -c "import json;r=json.load(open('$OUT/detect_request.json'));r['mode']='discovery';json.dump(r,open('$OUT/discovery_request.json','w'),ensure_ascii=False)"
echo "4/5 AI suggestions…"
curl -sS -X POST "$URL/api/detect-errors" -H "Content-Type: application/json" --data-binary @"$OUT/discovery_request.json" > "$OUT/discovery.json"
echo "5/5 Ask the corpus…"
for q in "Which errors should P6 teachers focus on?" "Which errors do learners not grow out of?"; do
  python3 -c "import json,sys;print(json.dumps({'question':sys.argv[1],'summary':json.load(open('$HERE/ask_summary.json',encoding='utf-8'))},ensure_ascii=False))" "$q" \
    | curl -sS -X POST "$URL/api/ask-corpus" -H "Content-Type: application/json" --data-binary @- >> "$OUT/ask.jsonl"; echo >> "$OUT/ask.jsonl"
done
cd "$HOME" && rm -f demo_capture.zip && zip -qr demo_capture.zip demo_capture
python3 -c "import json;d=json.load(open('$OUT/detect.json'));print('  cards:',len(d.get('candidates',[])),'· hidden:',d.get('suppressed'))"
echo "Done → $HOME/demo_capture.zip  (download it: ⋮ menu → Download → demo_capture.zip)"
