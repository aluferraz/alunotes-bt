# Load .env if present (plain KEY=VALUE format)
-include .env
export

.PHONY: install _install-system-deps _install-python-deps dev test lint serve clean

SHELL := /bin/bash
VENV := .venv
PYTHON := $(VENV)/bin/python
PIP := $(VENV)/bin/pip

# ---------- Venv ----------

$(VENV)/bin/activate:
	python3 -m venv $(VENV)
	$(PIP) install --upgrade pip

# ---------- Install ----------

install: _install-system-deps _install-python-deps

_install-system-deps:
	@echo "==> Installing system packages..."
	sudo apt-get update -qq
	sudo apt-get install -y -qq ffmpeg libsndfile1 libsox-dev sox curl

_install-python-deps: $(VENV)/bin/activate
	@echo "==> Installing Python dependencies..."
	$(PIP) install -e ".[dev]"

# ---------- Development ----------

dev: _install-python-deps
	@echo "==> Dev environment ready"

serve: $(VENV)/bin/activate
	$(PYTHON) -m uvicorn alunotes_ai.app:app --host 0.0.0.0 --port 8100 --reload

# ---------- Quality ----------

test: $(VENV)/bin/activate
	@echo "==> Running inference tests..." && \
	$(PYTHON) -m pytest tests/test_inference.py -v && \
	echo "==> Running ASR tests..." && \
	$(PYTHON) -m pytest tests/test_asr.py -v && \
	echo "==> Running diarization tests..." && \
	$(PYTHON) -m pytest tests/test_diarization.py -v

lint: $(VENV)/bin/activate
	$(PYTHON) -m ruff check alunotes_ai/ tests/
	$(PYTHON) -m mypy alunotes_ai/

# ---------- Clean ----------

clean:
	rm -rf __pycache__ .pytest_cache .mypy_cache .ruff_cache
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
