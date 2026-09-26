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
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


class LadderRung(BaseModel):
    question: str = ""
    answer: str = ""
    category: Optional[str] = None


class SuggestField(BaseModel):
    id: str = ""
    kind: str = "text"
    question: str
    options: list[str] = Field(default_factory=list)
    recommended: Optional[str] = None
    hint: Optional[str] = None
    # Per-field instruction for the suggestion model (e.g. "never invent an example").
    guide: Optional[str] = None


class SuggestRequest(BaseModel):
    target: str = "opus"
    intent: str
    ladder: list[LadderRung] = Field(default_factory=list)
    field: SuggestField
    # "suggest": propose a value for the field; "improve": rewrite the user's own text answer.
    mode: str = "suggest"
    answer: str = ""
    # Language of the human-facing text the model returns ("reason"): "en" (default) or "pt".
    locale: str = "en"


def _load(name: str, attr: str) -> Any:
    """Import a sibling module without a top-level Hermes dependency (hot-reload friendly).

    Returns the module once it exposes ``attr``; raises RuntimeError otherwise, whichever path loaded it.
    """
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
    if not hasattr(module, attr):
        raise RuntimeError(f"{name}.{attr} missing")
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
    id: str = ""
    # "enum" | "design" | "example" | "text": the writer tags settings, defaults and examples by it.
    kind: str = "text"
    question: str = ""
    answer: str = ""
    isDefault: Optional[bool] = None


class ComposeRequest(BaseModel):
    target: str = "opus"
    intent: str
    answers: list[ComposeAnswer] = Field(default_factory=list)
    baseline: str = ""
    # Language of the human-facing "notes": "en" (default) or "pt". The prompt follows the draft.
    locale: str = "en"


@router.post("/compose")
async def compose(request: ComposeRequest):
    if not request.intent.strip():
        return JSONResponse(status_code=400, content={"ok": False, "error": "intent is required"})
    try:
        return await asyncio.to_thread(_load("suggest_engine", "compose").compose, _payload(request))
    except Exception:
        logger.exception("Prompt Studio compose error:")
        return JSONResponse(status_code=500, content={"ok": False, "error": "compose engine unavailable"})


@router.get("/health")
async def health():
    try:
        return {"ok": True, "model": _load("llm_adapter", "get_model_label").get_model_label()}
    except Exception:
        logger.exception("Prompt Studio health error:")
        return {"ok": False, "error": "llm adapter unavailable"}
