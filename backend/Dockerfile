# Corpus OCR + Tamil error detection service (Cloud Run).
# Built automatically by `gcloud run deploy corpus-ocr --source ./backend` because this file exists.
FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1 \
    HF_HOME=/opt/hf TAMIL_RESOURCES=/opt/tamil TOKENIZERS_PARALLELISM=false

# hunspell (spelling validity) and foma/flookup (ThamizhiMorph morphology)
RUN apt-get update \
 && apt-get install -y --no-install-recommends hunspell foma curl ca-certificates libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# CPU-only PyTorch first (the default wheel bundles ~2 GB of GPU libraries Cloud Run cannot use)
RUN pip install --index-url https://download.pytorch.org/whl/cpu "torch>=2.7,<3"
COPY requirements.txt .
RUN pip install -r requirements.txt

# Tamil resources: Hunspell ta_IN dictionary + ThamizhiMorph finite-state models
RUN mkdir -p /opt/tamil/dict /opt/tamil/FST-Models \
 && H=https://raw.githubusercontent.com/cvsuser-chromium/third_party_hunspell_dictionaries/master \
 && curl -fsSL -o /opt/tamil/dict/ta_IN_raw.aff $H/ta_IN.aff \
 && curl -fsSL -o /opt/tamil/dict/ta_IN_raw.dic $H/ta_IN.dic \
 && T=https://raw.githubusercontent.com/sarves/thamizhi-morph/master/FST-Models \
 && for f in noun pronoun adj adv part verb-c3 verb-c4 verb-c11 verb-c12 verb-c62 verb-c-rest \
             noun-guess verb-guess adj-guess adv-guess; do \
      curl -fsSL -o /opt/tamil/FST-Models/$f.fst $T/$f.fst; done

# MuRIL (contextual real-word errors), baked into the image so the first request is not a 1 GB download
RUN python -c "from transformers import AutoTokenizer, AutoModelForMaskedLM as M; \
AutoTokenizer.from_pretrained('google/muril-base-cased'); M.from_pretrained('google/muril-base-cased')"

COPY . .
# prepare the Hunspell dictionary once and fail the build early if a Tamil layer is missing
RUN python -c "import tamil_detect as T; s = T.status(); print(s); assert s['hunspell'] and s['morphology'], s"

CMD exec uvicorn ocr_api:app --host 0.0.0.0 --port ${PORT:-8080}
