# Load .env if present (plain KEY=VALUE format)
-include .env
export

.PHONY: install _install-system-deps _install-python-deps _install-ollama \
       ollama-configure ollama-start ollama-stop ollama-pull \
       dev test lint serve clean

SHELL := /bin/bash
VENV := .venv
PYTHON := $(VENV)/bin/python
PIP := $(VENV)/bin/pip

OLLAMA_MODELS := huihui_ai/gemma-4-abliterated:e2b

# ---------- Venv ----------

$(VENV)/bin/activate:
	python3 -m venv $(VENV)
	$(PIP) install --upgrade pip

# ---------- Install ----------

install: _install-system-deps _install-python-deps _install-ollama

_install-system-deps:
	@echo "==> Installing system packages..."
	sudo apt-get update -qq
	sudo apt-get install -y -qq ffmpeg libsndfile1 libsox-dev sox curl

_install-python-deps: $(VENV)/bin/activate
	@echo "==> Installing Python dependencies..."
	$(PIP) install -e ".[dev]"

_install-ollama:
	@if command -v ollama >/dev/null 2>&1; then \
		echo "==> Ollama already installed: $$(ollama --version)"; \
	else \
		echo "==> Installing Ollama..."; \
		curl -fsSL https://ollama.com/install.sh | sh; \
	fi

# ---------- Ollama ----------

ollama-configure:
	@echo "==> Auto-configuring Ollama for this host..."
	bash scripts/ollama_autoconfig.sh

ollama-start:
	@if systemctl --user is-active ollama.service >/dev/null 2>&1; then \
		echo "==> Ollama already running (systemd user service)"; \
	elif systemctl is-active ollama.service >/dev/null 2>&1; then \
		echo "==> Ollama already running (systemd system service)"; \
	else \
		echo "==> Starting Ollama..."; \
		if [ -f .env ]; then set -a && source .env && set +a; fi; \
		OLLAMA_NOTELEMETRY=1 nohup ollama serve > /tmp/ollama.log 2>&1 & \
		echo "==> Ollama PID: $$!"; \
		sleep 2; \
	fi

ollama-stop:
	@-pkill -f 'ollama serve' 2>/dev/null || true
	@echo "==> Ollama stopped"

ollama-pull: ollama-start
	@echo "==> Pulling models..."
	@for model in $(OLLAMA_MODELS); do \
		echo "  Pulling $${model}..."; \
		ollama pull "$${model}"; \
	done
	@echo "==> All models pulled"

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
