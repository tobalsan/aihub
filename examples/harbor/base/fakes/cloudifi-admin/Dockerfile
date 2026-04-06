FROM python:3.12-slim

RUN pip install --no-cache-dir fastapi==0.115.0 "uvicorn[standard]==0.30.6"

WORKDIR /srv
COPY server.py /srv/server.py

# Base fixtures. Tasks mount / COPY over /fixtures to override specific
# endpoints per-task without rebuilding the sidecar image.
COPY fixtures /fixtures

EXPOSE 8080

# Use python stdlib for the healthcheck so we don't need curl in the image.
HEALTHCHECK --interval=2s --timeout=3s --start-period=3s --retries=15 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8080/healthz', timeout=2).status==200 else 1)"

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
