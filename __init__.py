"""Prompt Studio agent half: registers the `prompt_studio` auxiliary task.

The REST routes live in dashboard/ and are discovered through dashboard/manifest.json; this
module only makes the plugin's side-model a first-class `auxiliary.prompt_studio` slot so it shows
up in `hermes model` -> Configure auxiliary models and picks up the standard env/config resolution.
"""

import logging

logger = logging.getLogger(__name__)

AUX_TASK = "prompt_studio"


def register(ctx):
    register_task = getattr(ctx, "register_auxiliary_task", None)
    if register_task is None:
        # Hermes < 0.20 has no plugin auxiliary tasks; the engine still reads auxiliary.prompt_studio
        # from config.yaml directly, so the plugin keeps working without the picker entry.
        logger.debug("prompt-studio: host has no register_auxiliary_task; skipping picker registration")
        return
    register_task(
        AUX_TASK,
        display_name="Prompt Studio",
        description="Prompt Studio: per-step suggestions and the final prompt",
        defaults={"timeout": 20},
    )
