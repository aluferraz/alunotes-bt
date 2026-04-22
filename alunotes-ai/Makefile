# Load .env if present (plain KEY=VALUE format)
-include .env
export

.PHONY: install _install-system-deps _install-python-deps _install-torch dev test lint serve clean detect-gpu

SHELL := /bin/bash
VENV := .venv
PYTHON := $(VENV)/bin/python
PIP := $(VENV)/bin/pip
DISTROBOX_NAME ?= ubuntu24

# Repo root — used to locate the shared detect-gpu.sh helper.
PROJECT_ROOT := $(abspath $(CURDIR)/..)

# PyTorch wheel index per backend. Override ROCm / CUDA versions here when
# bumping; the CPU wheel is the same version as the CUDA default build, just
# stripped of the GPU kernels. ROCm 6.4 ships torch 2.9.1+rocm6.4 — needed
# because pyannote-audio 4.x hard-requires torch>=2.8; the rocm6.2 index
# tops out at torch 2.5 and would cause pip to silently fall back to a CUDA
# wheel. RDNA2 (gfx1030 family) is supported by rocm6.4 with
# HSA_OVERRIDE_GFX_VERSION=10.3.0 for the Radeon 680M (gfx1035).
TORCH_ROCM_INDEX ?= https://download.pytorch.org/whl/rocm6.4
TORCH_CPU_INDEX  ?= https://download.pytorch.org/whl/cpu

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

_install-python-deps: $(VENV)/bin/activate _install-torch
	@echo "==> Installing project Python dependencies..."
	$(DBOX) $(PIP) install -e ".[dev]"

# Install the torch wheel that matches the detected GPU backend. Runs BEFORE
# `pip install -e .[dev]` so the project install finds torch already resolved
# and doesn't pull the default (CUDA) wheel. On a re-run we skip the reinstall
# when the currently installed wheel already targets the right backend — torch
# exposes this via torch.version.hip / torch.version.cuda.
# On SteamOS the rootfs (/) is a tiny read-only overlay (~5 GB) and /tmp is a
# tmpfs backed by the same pool, so pip's default extract dir can't hold the
# ~4 GB torch-rocm wheel. Force pip's scratch + cache onto the project tree
# (which lives on /home — hundreds of GB) so downloads and extraction both
# land on the big partition. No-op on hosts with plenty of /tmp.
PIP_SCRATCH := $(CURDIR)/.pip-tmp
PIP_CACHE   := $(CURDIR)/.pip-cache

_install-torch: $(VENV)/bin/activate
	@backend=$$(bash $(PROJECT_ROOT)/scripts/detect-gpu.sh); \
	echo "==> Detected GPU backend: $$backend"; \
	current=$$($(DBOX) $(PYTHON) -c "import torch,sys; v=torch.version; sys.stdout.write('rocm' if v.hip else 'cuda' if v.cuda else 'cpu')" 2>/dev/null || echo missing); \
	if [ "$$current" = "$$backend" ]; then \
		echo "==> torch already installed for $$backend — skipping"; \
		exit 0; \
	fi; \
	echo "==> Installing torch for $$backend (was: $$current)"; \
	mkdir -p $(PIP_SCRATCH) $(PIP_CACHE); \
	PIP_ENV="env TMPDIR=$(PIP_SCRATCH) PIP_CACHE_DIR=$(PIP_CACHE)"; \
	case "$$backend" in \
		rocm) $(DBOX) $$PIP_ENV $(PIP) install --upgrade --force-reinstall torch torchaudio --index-url $(TORCH_ROCM_INDEX) ;; \
		cuda) $(DBOX) $$PIP_ENV $(PIP) install --upgrade --force-reinstall torch torchaudio ;; \
		cpu)  $(DBOX) $$PIP_ENV $(PIP) install --upgrade --force-reinstall torch torchaudio --index-url $(TORCH_CPU_INDEX) ;; \
		*) echo "unknown backend: $$backend" >&2; exit 1 ;; \
	esac; \
	rm -rf $(PIP_SCRATCH)

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

# ---------- Diagnostics ----------

# Report what `make install` would pick for the torch wheel on this host.
# Honors $AI_GPU_BACKEND override, same as the install path.
detect-gpu:
	@backend=$$(bash $(PROJECT_ROOT)/scripts/detect-gpu.sh); \
	echo "detected backend: $$backend"; \
	current=$$($(DBOX) $(PYTHON) -c "import torch,sys; v=torch.version; sys.stdout.write('rocm' if v.hip else 'cuda' if v.cuda else 'cpu')" 2>/dev/null || echo "not installed"); \
	echo "installed torch: $$current"

# ---------- Clean ----------

clean:
	rm -rf __pycache__ .pytest_cache .mypy_cache .ruff_cache
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
