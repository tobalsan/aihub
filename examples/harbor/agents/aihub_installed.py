"""
Harbor installed-agent wrapper for AIHub.

Drops into Harbor as `--agent aihub-installed`. Expects the container to be
built from `examples/harbor/base/aihub-eval` (directly or via FROM), which
bakes the `aihub` CLI and a minimal `aihub.json`.

The wrapper does not boot AIHub itself — it only shells out to
`aihub eval run` inside the container. All agent behavior lives in the
AIHub runtime; Harbor just orchestrates trials and reads the output
contract (`/logs/agent/result.json` + `/logs/agent/trajectory.json`).

To register this with Harbor, drop it on Harbor's agent search path (see
Harbor's "Integrating your own agent" docs) or reference it as a local
module when invoking `harbor run`.
"""
from __future__ import annotations

import json
import shlex
from pathlib import Path

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext


class AIHubInstalledAgent(BaseInstalledAgent):
    """
    Minimal wrapper. `aihub_agent` is the agent id (as defined in the eval
    container's aihub.json) to evaluate; defaults to "sally" and can
    be overridden via task.toml [metadata] or agent kwargs.
    """

    DEFAULT_AIHUB_AGENT = "sally"
    INSTRUCTION_PATH = "/app/instruction.md"
    RESULT_PATH = "/logs/agent/result.json"
    TRAJECTORY_PATH = "/logs/agent/trajectory.json"

    @staticmethod
    def name() -> str:
        return "aihub-installed"

    def version(self) -> str | None:
        return "0.1.0"

    async def install(self, environment: BaseEnvironment) -> None:
        # The aihub CLI is baked into aihub-eval-base; nothing to install.
        return None

    @with_prompt_template
    async def run(
        self,
        instruction: str,
        environment: BaseEnvironment,
        context: AgentContext,
    ) -> None:
        # Write the instruction into the container so aihub eval run can
        # read it from a stable path.
        await self.exec_as_agent(
            environment,
            command=f"mkdir -p /app && cat > {self.INSTRUCTION_PATH} <<'AIHUB_EOF'\n{instruction}\nAIHUB_EOF",
        )

        aihub_agent = self._resolve_agent_id(context)
        cmd = (
            "aihub eval run"
            f" --agent {shlex.quote(aihub_agent)}"
            f" --instruction-file {self.INSTRUCTION_PATH}"
            f" --output {self.RESULT_PATH}"
            f" --trace {self.TRAJECTORY_PATH}"
        )
        await self.exec_as_agent(environment, command=cmd)

    def populate_context_post_run(self, context: AgentContext) -> None:
        """
        Read result.json and populate AgentContext for Harbor's metrics
        aggregation. Errors are non-fatal: if the agent failed to write
        result.json, the verifier will detect it via its own assertions.
        """
        result_path = self.logs_dir / "agent" / "result.json"
        if not result_path.exists():
            return
        try:
            result = json.loads(result_path.read_text())
        except Exception:
            return

        metrics = result.get("metrics") or {}
        context.cost_usd = float(metrics.get("costUsd", 0) or 0)
        context.n_input_tokens = int(metrics.get("inputTokens", 0) or 0)
        context.n_output_tokens = int(metrics.get("outputTokens", 0) or 0)

    def _resolve_agent_id(self, context: AgentContext) -> str:
        # task.toml [metadata] can set aihub_agent to target a different
        # agent from the default. Harbor passes metadata through on
        # AgentContext.metadata.
        metadata = getattr(context, "metadata", None) or {}
        if isinstance(metadata, dict):
            value = metadata.get("aihub_agent")
            if isinstance(value, str) and value:
                return value
        return self.DEFAULT_AIHUB_AGENT
