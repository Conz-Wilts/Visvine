# The agent's machine.
#
# One image for every agent in every space — image storage is 50 GB for the
# whole account, so a per-space image is not something this platform can afford.
# It stays lean for a second reason: every gigabyte is paid again as cold-wake
# seconds, and a wake happens whenever the machine has been idle ten minutes.
#
# The local disk is a cache, not storage. Anything that must survive a sleep is
# written to the space's R2 workspace.
FROM node:22-slim

# Python and uv sit beside Node because an agent writes whichever the task wants,
# and ripgrep because searching a workspace is the most common thing it does.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl git ripgrep python3 python3-venv util-linux \
  && rm -rf /var/lib/apt/lists/*
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh

# The screen. Xvfb is the display the browser draws on, ffmpeg grabs frames off
# it for the window, and xdotool replays a human's clicks and keys onto it
# during a takeover. A window manager is not installed: one browser, full
# screen, is the whole desktop an agent needs, and every megabyte here is paid
# again as cold-wake seconds on every wake.
RUN apt-get update \
  && apt-get install -y --no-install-recommends xvfb x11-utils xdotool ffmpeg fonts-liberation libnss3-tools \
  && rm -rf /var/lib/apt/lists/*

# Chromium, through Playwright, so the browser and the driver agree about
# versions. `--with-deps` pulls the system libraries a headful Chromium needs.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/playwright \
    NODE_PATH=/usr/local/lib/node_modules
RUN npm install -g playwright@1.58.2 \
  && npx --yes playwright@1.58.2 install --with-deps chromium \
  && rm -rf /root/.npm

# Anything that reads a CA bundle from an environment variable rather than the
# system trust store needs pointing at it, or its requests fail verification
# behind the egress proxy — Node and Python are the two that matter here.
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt \
    REQUESTS_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt \
    CURL_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
    DISPLAY=:99 \
    SCREEN_WIDTH=1280 \
    SCREEN_HEIGHT=800

# Nothing pre-authenticated: no cloud CLI with ambient credentials, no key baked
# into a layer. What the machine may reach is the egress policy's answer, and
# what it may reach it WITH is injected outside the container by the edge.
RUN useradd --create-home --shell /bin/bash agent
WORKDIR /workspace
RUN chown -R agent:agent /workspace

# The entrypoint starts as root only long enough to install the interception CA,
# then drops to the agent user for the life of the machine. Commands run under
# that user too (the exec call names it).
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY screen.mjs /usr/local/lib/screen.mjs
COPY browse.mjs /usr/local/lib/browse.mjs
RUN chmod +x /usr/local/bin/entrypoint.sh
CMD ["/usr/local/bin/entrypoint.sh"]
