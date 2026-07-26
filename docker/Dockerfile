# Stage 1: runtime base - system packages, npm deps, Chromium (rarely changes)
#
# Keep this tag on the same major.minor as the playwright version resolved in
# package-lock.json. When they drift, `playwright install` below deletes the
# browsers this image ships and downloads ~180 MB of replacements on every
# build. TestBaseImageMatchesLockedPlaywright guards the pairing.
FROM mcr.microsoft.com/playwright:v1.58.0-noble AS base

RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb x11vnc novnc python3-websockify unzip scrot openbox ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/extensions/idcac \
    && curl -fsSL -o /tmp/idcac.zip \
       https://github.com/OhMyGuus/I-Still-Dont-Care-About-Cookies/releases/download/v1.1.9/ISDCAC-chrome-source.zip \
    && unzip -q /tmp/idcac.zip -d /opt/extensions/idcac \
    && rm /tmp/idcac.zip

# Runtime state lives off /tmp so the host's /tmp can be bind-mounted at /tmp.
ENV WEB_STATE_DIR=/state
RUN mkdir -p /state && chmod 1777 /state

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev && npx playwright install chromium \
    && node -e "console.log(require('playwright').chromium.executablePath())" > /app/.chromium-path

# Static files that never change on code edits
COPY docker/entrypoint.sh /entrypoint.sh
COPY docker/web2-wrapper.sh /usr/local/bin/web2
RUN chmod +x /entrypoint.sh /usr/local/bin/web2

# Stage 2: build TypeScript (only re-runs on src/ or tsconfig changes)
FROM base AS build
RUN --mount=type=cache,target=/root/.npm npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npx tsc

# Stage 3: final image — cached base + compiled JS
FROM base
COPY --from=build /app/dist/ dist/

ENV WEB_CONTAINER=1
EXPOSE 5900 6080
LABEL web2=true
ENTRYPOINT ["/entrypoint.sh"]
