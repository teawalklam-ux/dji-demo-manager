FROM python:3.12.14-alpine3.24@sha256:d09d15e60962ca365d1cd544a48773bac9d33f2fb1b00f2aa0deec78ade7dc31

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN addgroup -g 1000 archive \
    && adduser -D -u 1000 -G archive archive

WORKDIR /app
COPY --chown=archive:archive archive_agent.py /app/archive_agent.py

USER archive
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD ["python", "/app/archive_agent.py", "--healthcheck"]

ENTRYPOINT ["python", "/app/archive_agent.py"]
