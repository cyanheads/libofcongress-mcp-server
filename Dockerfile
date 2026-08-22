# ==============================================================================
# Build Stage
#
# This stage installs all dependencies (including dev), builds the TypeScript
# source code into JavaScript, and prepares the production assets.
# ==============================================================================
# Pin the build stage to the native builder architecture. Running Bun's JSC under
# QEMU during an amd64 leg can exhaust memory before the TypeScript build starts.
FROM --platform=$BUILDPLATFORM oven/bun:1.4.0 AS build

WORKDIR /usr/src/app

# Copy dependency manifests for optimized layer caching
COPY package.json bun.lock ./

# Install all dependencies (including dev dependencies for building).
# The BuildKit cache mount persists Bun's global package cache across builds.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --ignore-scripts

# Copy the rest of the source code
COPY . .

# Build the application
RUN bun run build


# ==============================================================================
# Production Stage
#
# Minimal Bun image — only runs the pre-compiled dist/index.js at startup.
# ==============================================================================
FROM oven/bun:1.4.0-slim AS production

WORKDIR /usr/src/app

# Set the environment to production
ENV NODE_ENV=production

# OCI image metadata (https://github.com/opencontainers/image-spec/blob/main/annotations.md)
ARG APP_VERSION
LABEL org.opencontainers.image.title="libofcongress-mcp-server"
LABEL org.opencontainers.image.description="Search LOC digital collections, browse Chronicling America newspapers with full OCR text, and look up LC Subject Headings via MCP."
LABEL org.opencontainers.image.licenses="Apache-2.0"
LABEL org.opencontainers.image.source="https://github.com/cyanheads/libofcongress-mcp-server"
LABEL org.opencontainers.image.version="${APP_VERSION}"

# Copy dependency manifests
COPY package.json bun.lock ./

# Install only production dependencies. Optional peers are installed explicitly
# below only when their feature tier is enabled.
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --production --omit=peer --frozen-lockfile --ignore-scripts

# Conditionally install OpenTelemetry optional peer dependencies (Tier 3).
# Enable at build time with: docker build --build-arg OTEL_ENABLED=true
ARG OTEL_ENABLED=true
RUN --mount=type=cache,target=/root/.bun/install/cache \
    if [ "$OTEL_ENABLED" = "true" ]; then \
      bun add --omit=dev --omit=peer --ignore-scripts @hono/otel \
        @opentelemetry/instrumentation-http \
        @opentelemetry/exporter-metrics-otlp-http \
        @opentelemetry/exporter-trace-otlp-http \
        @opentelemetry/instrumentation-pino \
        @opentelemetry/resources \
        @opentelemetry/sdk-metrics \
        @opentelemetry/sdk-node \
        @opentelemetry/sdk-trace-node \
        @opentelemetry/semantic-conventions; \
    fi

# Copy the compiled application code from the build stage
COPY --from=build /usr/src/app/dist ./dist

# Create log directory
RUN mkdir -p /var/log/libofcongress-mcp-server && chown -R bun:bun /var/log/libofcongress-mcp-server

USER bun

ARG PORT

ENV MCP_HTTP_PORT=${PORT:-3010}
ENV MCP_HTTP_HOST="0.0.0.0"
ENV MCP_TRANSPORT_TYPE="http"
ENV MCP_SESSION_MODE="stateless"
ENV MCP_LOG_LEVEL="info"
ENV LOGS_DIR="/var/log/libofcongress-mcp-server"
ENV MCP_FORCE_CONSOLE_LOGGING="true"

EXPOSE ${MCP_HTTP_PORT}

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD bun -e "fetch('http://localhost:'+(process.env.MCP_HTTP_PORT??'3010')+'/healthz').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["bun", "run", "dist/index.js"]
