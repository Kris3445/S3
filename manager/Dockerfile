FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
WORKDIR /app
COPY pyproject.toml README.md ./
COPY bot ./bot
COPY tests ./tests
RUN pip install --upgrade pip && pip install .
CMD ["python", "-m", "bot.main"]
