# hapi hub image — self-contained runtime for the fork's `hub` binary.
#
# Introduced by mouriya-s-lab/hapi#72 (Release image pipeline) and consumed
# by the homelab compose stack at `homelab-tf/komodo/roles/komodo-stacks/
# templates/hapi/compose.yaml.j2` — the previous "buildpack-deps base +
# curl release tarball at container start" shape (upstream homelab-tf#332)
# gets replaced by pulling `registry.237575.xyz/hapi/hub:stable` directly.
#
# Fork-only file. Rebases from `tiann/hapi` will not touch it because
# upstream ships no root `Dockerfile`. See `~/.claude/rules/
# fork-customization-placement.rule.md`.

# --- Stage 1: bun-based builder -------------------------------------------
# Matches release.yml's bun-version pin so the image is built with the same
# bun runtime as the GitHub Release binaries. `bookworm` variant → glibc
# builder consistent with the runtime stage below.
FROM oven/bun:1.3.14-debian AS builder

# HAPI_FORK_VERSION: baked into web bundle so `Settings → About` shows the
# fork tag. Same env the release workflow sets from `${{ github.ref_name }}`.
# Left empty by default for local `docker build` (bun tolerates unset).
ARG HAPI_FORK_VERSION=""
ENV HAPI_FORK_VERSION=${HAPI_FORK_VERSION}

WORKDIR /src

# Copy the whole workspace (bun install needs every package's package.json,
# and the build:web / build:hub / bun-single-exe steps read the full tree).
# .dockerignore trims node_modules, dist, git, etc. so the context stays
# small on GARM LXD runners.
COPY . .

# Install workspace deps. `--frozen-lockfile` locks against bun.lock so the
# resulting binary matches CI Release output byte-wise up to bun tooling
# determinism.
RUN bun install --frozen-lockfile

# `build:single-exe` runs, in order:
#   1. `bun run download:tunwg` — fetches tunwg binaries from GitHub Releases
#      into `shared/tools/tunwg/` (network needed at BUILD time only; the
#      resulting binary is embedded into the single-exe hapi output).
#   2. `bun run build:web` — vite build for the web/ workspace.
#   3. `bun run generate:embedded-web-assets` inside hub/ — bakes web/dist
#      into a TS module the hub imports.
#   4. `bun run build:exe:allinone` inside cli/ — bun compile emits
#      `cli/dist-exe/bun-linux-x64-baseline/hapi` on linux/x64 hosts
#      (host-default target per `cli/scripts/build-executable.ts`).
# On a linux/amd64 GARM runner, no `--target` is passed so the produced
# binary matches the runtime base (Debian glibc, x86-64 baseline ISA).
RUN bun run build:single-exe

# Sanity: fail the build immediately if the expected artifact path is
# missing. Catches upstream changes to build-executable.ts's output layout
# before they silently break the runtime stage's COPY.
RUN test -x /src/cli/dist-exe/bun-linux-x64-baseline/hapi \
    || (echo "FATAL: single-exe binary missing at expected path" >&2 \
        && ls -la /src/cli/dist-exe/ >&2 && exit 1)

# --- Stage 2: runtime -----------------------------------------------------
# Slim glibc-based Debian 12 (bookworm) — matches the buildpack-deps base
# the homelab compose currently uses, so any runtime-level assumptions
# (glibc version, ca-certificates location) hold across the cutover.
FROM debian:bookworm-slim AS runtime

# ca-certificates for outbound TLS to Cloudflare/GitHub/agent-runtime.
# tini as PID 1 → propagates SIGTERM cleanly to `hapi hub`, so
# `docker stop` / compose restart doesn't leak child processes.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /src/cli/dist-exe/bun-linux-x64-baseline/hapi /usr/local/bin/hapi
RUN chmod +x /usr/local/bin/hapi

# Match `homelab-tf/komodo/roles/komodo-stacks/templates/hapi/compose.yaml.j2`
# runtime shape:
#   ports: "3006:3006"
#   environment: HAPI_LISTEN_HOST=0.0.0.0, HAPI_LISTEN_PORT=3006
#   volumes: hapi-data:/root/.hapi
# See `hub/src/config/serverSettings.ts:173-190` for the env→config binding.
ENV HAPI_LISTEN_HOST=0.0.0.0
ENV HAPI_LISTEN_PORT=3006

EXPOSE 3006
VOLUME ["/root/.hapi"]

# tini reaps children + forwards signals; hapi hub in --no-relay mode is
# the sole long-running process. Same command shape the compose runs today.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/hapi", "hub", "--no-relay"]
