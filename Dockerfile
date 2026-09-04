# hapi hub image — self-contained runtime for the fork's release binary.
#
# The GitHub-hosted Release workflow is the sole compiler. publish-image
# downloads `hapi-linux-x64-baseline.tar.gz` into `.image/` and packages that
# exact binary. The GARM runner therefore does not repeat the Bun/Vite build
# and cannot diverge from the published release artifact (hapi#77).

FROM debian:bookworm-slim AS runtime

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*

COPY .image/hapi /usr/local/bin/hapi
RUN chmod +x /usr/local/bin/hapi

ENV HAPI_LISTEN_HOST=0.0.0.0
ENV HAPI_LISTEN_PORT=3006

EXPOSE 3006
VOLUME ["/root/.hapi"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/hapi", "hub", "--no-relay"]
