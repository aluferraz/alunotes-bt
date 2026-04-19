# Load .env if present (plain KEY=VALUE format)
-include .env
export

.PHONY: install _install-system-deps _install-python-deps dev test lint serve clean

SHELL := /bin/bash
VENV := .venv
PYTHON := $(VENV)/bin/python
PIP := $(VENV)/bin/pip
DISTROBOX_NAME ?= ubuntu24

# Detect running inside a distrobox/toolbox container. When invoked from the
# host (e.g. SteamOS, where apt-get / python3 are unavailable), commands are
# forwarded into the distrobox automatically. Inside the box, DBOX is empty
# and everything runs in place.
IN_DISTROBOX := $(shell [ -f /run/.containerenv ] && echo 1)

ifeq ($(IN_DISTROBOX),1)
DBOX :=
else
DBOX := distrobox enter $(DISTROBOX_NAME) --
endif

# ---------- Venv ----------

$(VENV)/bin/activate:
	$(DBOX) python3 -m venv $(VENV)
	$(DBOX) $(PIP) install --upgrade pip

# ---------- Install ----------

install: _install-system-deps _install-python-deps

_install-system-deps:
	@echo "==> Installing system packages..."
	$(DBOX) sudo apt-get update -qq
	$(DBOX) sudo apt-get install -y -qq ffmpeg libsndfile1 libsox-dev sox curl

_install-python-deps: $(VENV)/bin/activate
	@echo "==> Installing Python dependencies..."
	$(DBOX) $(PIP) install -e ".[dev]"

# ---------- Development ----------

dev: _install-python-deps
	@echo "==> Dev environment ready"

serve: $(VENV)/bin/activate
	$(DBOX) $(PYTHON) -m uvicorn alunotes_ai.app:app --host 0.0.0.0 --port 8100 --reload

# ---------- Quality ----------

test: $(VENV)/bin/activate
	@echo "==> Running inference tests..." && \
	$(DBOX) $(PYTHON) -m pytest tests/test_inference.py -v && \
	echo "==> Running ASR tests..." && \
	$(DBOX) $(PYTHON) -m pytest tests/test_asr.py -v && \
	echo "==> Running diarization tests..." && \
	$(DBOX) $(PYTHON) -m pytest tests/test_diarization.py -v

lint: $(VENV)/bin/activate
	$(DBOX) $(PYTHON) -m ruff check alunotes_ai/ tests/
	$(DBOX) $(PYTHON) -m mypy alunotes_ai/

# ---------- Clean ----------

clean:
	rm -rf __pycache__ .pytest_cache .mypy_cache .ruff_cache
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
