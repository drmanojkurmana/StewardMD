.PHONY: install dev test lint fmt docker-build docker-up docker-down

install:        ## install runtime + dev deps into the active venv
	pip install -r requirements.txt && pip install pytest ruff

dev:            ## run the API with hot reload (mock mode unless .env says otherwise)
	uvicorn app.main:app --reload --port 8000

test:           ## run the test suite
	pytest -q

lint:           ## static checks
	ruff check app tests

fmt:            ## auto-format
	ruff format app tests

docker-build:
	docker build -t kardiox-pipeline:latest .

docker-up:
	docker compose up --build

docker-down:
	docker compose down
