FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY doradoor .
COPY config.yaml .
COPY web ./web

RUN adduser -D -u 1000 appuser && \
    find /app/web -name "*.fasthttp.br" -delete 2>/dev/null || true

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3001/health || exit 1

ENTRYPOINT ["./doradoor"]
CMD ["-config", "config.yaml"]
