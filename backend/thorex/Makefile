.PHONY: dev test test-models docker
dev: ; uvicorn app.main:app --reload --port 8000
test: ; python -m pytest -m "not models" -v
test-models: ; python -m pytest -m models -v
docker: ; docker compose up --build
