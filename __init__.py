"""Prompt Studio agent half: registers the `prompt_studio` auxiliary task.

The REST routes live in dashboard/ and are discovered through dashboard/manifest.json; this
module only makes the plugin's side-model a first-class `auxiliary.prompt_studio` slot so it shows
up in `hermes model` -> Configure auxiliary models and picks up the standard env/config resolution.
"""

AUX_TASK = "prompt_studio"


def register(ctx):
    # plugin.yaml requires_hermes (>=0.21.5): the plugin context always has register_auxiliary_task.
    ctx.register_auxiliary_task(
        AUX_TASK,
        display_name="Prompt Studio",
        description="Prompt Studio: per-step suggestions and the final prompt",
        defaults={"timeout": 20},
    )
