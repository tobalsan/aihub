FROM aihub-eval-base:local

# Smoke task provides its own minimal agent config.
USER root
COPY environment/aihub.json /eval/aihub.json

# Minimal agent workspace with just an identity file.
RUN mkdir -p /eval/agents/smoke && \
    echo "You are a minimal test agent. Follow instructions exactly." > /eval/agents/smoke/IDENTITY.md

RUN chown -R agent:agent /eval
USER agent
