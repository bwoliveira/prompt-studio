"""FastAPI routes for the Prompt Studio, mounted at /api/plugins/prompt-studio/.

/suggest (per-step AI help), /compose (AI-written final prompt) and /health. The steps and the
baseline prompt are built in the desktop half by the Studio's own prompt engines.
Request models must declare every field the desktop sends: pydantic drops unknown fields.
"""
from __future__ import annotations

import asyncio
import importlib
import importlib.util
import logging
import os
from pathlib import Path
from typing import Annotated, Any, Literal, Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


# Size limits (SE-4): generous enough for anything the desktop sends (a pasted third-party text can
# be large), but every string and list is bounded. Over-limit requests get FastAPI's 422, which the
# desktop treats like any other failure (no AI help, local prompt kept).
BIG_TEXT = 250_000  # draft, answers, baseline
MID_TEXT = 20_000  # questions, hints, field guidance
SHORT_TEXT = 200  # ids, kinds, targets, modes, locales
MAX_ITEMS = 50  # ladder rungs, answers, options
SESSION_CONTEXT_TEXT = 3000  # the /context summary sent back with /suggest


class ModelChoice(BaseModel):
    """Per-task model (CX-1). Empty model = the ``auxiliary.prompt_studio`` config, as before.
    effort: '' = config/provider default, 'none' = thinking off, else a Hermes reasoning effort;
    anything else is a 422."""
    provider: str = Field("", max_length=80)
    model: str = Field("", max_length=200)
    effort: Literal["", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] = Field("", max_length=16)


class LadderRung(BaseModel):
    question: str = Field("", max_length=MID_TEXT)
    answer: str = Field("", max_length=BIG_TEXT)
    category: Optional[str] = Field(None, max_length=SHORT_TEXT)


class SuggestField(BaseModel):
    id: str = Field("", max_length=SHORT_TEXT)
    kind: str = Field("text", max_length=SHORT_TEXT)
    question: str = Field(max_length=MID_TEXT)
    options: list[Annotated[str, Field(max_length=MID_TEXT)]] = Field(default_factory=list, max_length=MAX_ITEMS)
    recommended: Optional[str] = Field(None, max_length=MID_TEXT)
    hint: Optional[str] = Field(None, max_length=MID_TEXT)
    # Per-field instruction for the suggestion model (e.g. "never invent an example").
    guide: Optional[str] = Field(None, max_length=MID_TEXT)


class SuggestRequest(BaseModel):
    target: str = Field("opus", max_length=SHORT_TEXT)
    intent: str = Field(max_length=BIG_TEXT)
    ladder: list[LadderRung] = Field(default_factory=list, max_length=MAX_ITEMS)
    field: SuggestField
    # "suggest": propose a value for the field; "improve": rewrite the user's own text answer.
    mode: str = Field("suggest", max_length=SHORT_TEXT)
    answer: str = Field("", max_length=BIG_TEXT)
    # Language of the human-facing text the model returns ("reason"): "en" (default) or "pt".
    locale: str = Field("en", max_length=SHORT_TEXT)
    model_choice: Optional[ModelChoice] = None
    # Summary from /context: untrusted background for the suggestion model only.
    session_context: str = Field("", max_length=SESSION_CONTEXT_TEXT)


# Loaded sibling modules, name -> (file signature, module). The host imports this file by path and the
# route handlers call _load() on every request: re-executing a sibling each time would build new thread
# pools (suggest/compose/context) and drop their concurrency caps. Reload only when a file changed, or
# on every call with the dev switch below.
_MODULES: dict[str, tuple[tuple, Any]] = {}
DEV_RELOAD_ENV = "PROMPT_STUDIO_DEV_RELOAD"


def _signature() -> tuple:
    """mtimes of the sibling modules (they import each other, so any change reloads them all)."""
    here = Path(__file__).parent
    stamps = []
    for path in sorted(here.glob("*.py")):
        try:
            stamps.append((path.name, path.stat().st_mtime_ns))
        except OSError:
            continue
    return tuple(stamps)


def _load(name: str, attr: str) -> Any:
    """Import a sibling module without a top-level Hermes dependency (hot-reload friendly).

    Loaded once per process; reloaded when a file's mtime changed or when ``PROMPT_STUDIO_DEV_RELOAD`` is
    set to a truthy value. Returns the module once it exposes ``attr``; raises RuntimeError otherwise,
    whichever path loaded it.
    """
    signature = _signature()
    cached = _MODULES.get(name)
    dev = os.environ.get(DEV_RELOAD_ENV, "").strip().lower() in ("1", "true", "yes", "on")
    if cached is not None and cached[0] == signature and not dev:
        module = cached[1]
    else:
        module = _import(name)
        _MODULES[name] = (signature, module)
    if not hasattr(module, attr):
        raise RuntimeError(f"{name}.{attr} missing")
    return module


def _import(name: str) -> Any:
    module = None
    try:
        module = importlib.import_module(f".{name}", __package__) if __package__ else None
    except (ImportError, ValueError):
        module = None
    if module is not None:
        try:
            module = importlib.reload(module)
        except Exception:
            logger.debug("Prompt Studio: reload of %s failed; using the loaded copy", name, exc_info=True)
    else:
        spec = importlib.util.spec_from_file_location(f"prompt_studio_{name}", Path(__file__).with_name(f"{name}.py"))
        if spec is None or spec.loader is None:
            raise RuntimeError(f"{name} could not be loaded")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
    return module


def _payload(request: BaseModel) -> dict:
    return request.model_dump() if hasattr(request, "model_dump") else request.dict()


@router.post("/suggest")
async def suggest(request: SuggestRequest):
    if not request.intent.strip() or not request.field.question.strip():
        return JSONResponse(status_code=400, content={"ok": False, "error": "intent and field.question are required"})
    try:
        return await asyncio.to_thread(_load("suggest_engine", "suggest").suggest, _payload(request))
    except Exception:
        logger.exception("Prompt Studio suggest error:")
        return JSONResponse(status_code=500, content={"ok": False, "error": "suggest engine unavailable"})


class ComposeAnswer(BaseModel):
    id: str = Field("", max_length=SHORT_TEXT)
    # "enum" | "design" | "example" | "text": the writer tags settings, defaults and examples by it.
    kind: str = Field("text", max_length=SHORT_TEXT)
    question: str = Field("", max_length=MID_TEXT)
    answer: str = Field("", max_length=BIG_TEXT)
    isDefault: Optional[bool] = None


class ComposeRequest(BaseModel):
    target: str = Field("opus", max_length=SHORT_TEXT)
    intent: str = Field(max_length=BIG_TEXT)
    answers: list[ComposeAnswer] = Field(default_factory=list, max_length=MAX_ITEMS)
    baseline: str = Field("", max_length=BIG_TEXT)
    # Language of the human-facing "notes": "en" (default) or "pt". The prompt follows the draft.
    locale: str = Field("en", max_length=SHORT_TEXT)
    model_choice: Optional[ModelChoice] = None


@router.post("/compose")
async def compose(request: ComposeRequest):
    if not request.intent.strip():
        return JSONResponse(status_code=400, content={"ok": False, "error": "intent is required"})
    try:
        return await asyncio.to_thread(_load("suggest_engine", "compose").compose, _payload(request))
    except Exception:
        logger.exception("Prompt Studio compose error:")
        return JSONResponse(status_code=500, content={"ok": False, "error": "compose engine unavailable"})


class ContextRequest(BaseModel):
    session_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9_.:-]+$")
    profile: str = Field("", max_length=64, pattern=r"^[A-Za-z0-9_-]*$")
    locale: str = Field("en", max_length=SHORT_TEXT)
    model_choice: Optional[ModelChoice] = None


@router.post("/context")
async def context(request: ContextRequest):
    try:
        return await asyncio.to_thread(_load("session_context", "context").context, _payload(request))
    except Exception:
        logger.exception("Prompt Studio context error:")
        return {"ok": False, "code": "unavailable", "error": "context reader unavailable"}


@router.get("/health")
async def health():
    try:
        return {"ok": True, "model": _load("llm_adapter", "get_model_label").get_model_label()}
    except Exception:
        logger.exception("Prompt Studio health error:")
        return {"ok": False, "error": "llm adapter unavailable"}
