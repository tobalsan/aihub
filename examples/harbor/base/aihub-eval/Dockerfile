# Base image every Harbor task FROMs.
# Bakes the aihub CLI and a minimal aihub.json so `aihub eval run` works
# headlessly inside the trial container.
#
# Built once per dev loop with:
#   docker build -t aihub-eval-base:local examples/harbor/base/aihub-eval
#
# Task images then:
#   FROM aihub-eval-base:local

FROM node:20-slim

# System deps:
# - curl, ca-certificates: outbound HTTPS during image build (runtime tasks use allow_internet=false)
# - python3: required by uv-managed pytest at verifier runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

# Install uv (and uvx) as static binaries from the official Astral image.
# Using a multi-stage COPY avoids running the install script and keeps the
# binary version pinned to whatever uv:latest resolves to at build time.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

# Install pytest into a system-wide uv tool location so the non-root `agent`
# user can run it offline at verifier time. /opt/uv/* is world-readable by
# default which is exactly what we want here.
ENV UV_TOOL_DIR=/opt/uv/tools \
    UV_TOOL_BIN_DIR=/opt/uv/bin \
    PATH=/opt/uv/bin:${PATH}
RUN mkdir -p /opt/uv && uv tool install pytest==8.4.1

# Install pnpm (used to build aihub from source in this PR; a published
# binary can replace this once the eval CLI ships)
RUN npm install -g pnpm@9

# Create the non-root user Harbor expects (task.toml [agent].user = "agent")
RUN useradd --create-home --shell /bin/bash agent

# AIHUB_HOME for the eval container. aihub.json + connectors live here.
ENV AIHUB_HOME=/eval
RUN mkdir -p /eval /logs/agent /logs/verifier /app/out \
    && chown -R agent:agent /eval /logs /app

# Copy the minimal aihub.json used inside eval containers.
# Real connector code is loaded from the aihub-connectors package on install.
COPY aihub.json /eval/aihub.json

# aihub CLI is expected on PATH. For the first PR, the image is built from
# the monorepo root so we can `pnpm install` + link the CLI; later we switch
# to a published tarball. See examples/harbor/base/aihub-eval/README.md.
# Placeholder install step (wire up in follow-up once eval CLI lands):
# COPY --from=build /workspace/apps/gateway/dist /opt/aihub
# RUN ln -s /opt/aihub/cli.js /usr/local/bin/aihub

USER agent
WORKDIR /app
