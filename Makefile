UV ?= uv
NPM ?= npm
DJANGO_PORT ?= 8000
FRONTEND_PORT ?= 5173
EXECUTOR_JOB_IMAGE ?= orgsdk-job:dev
EXECUTOR_SUPERVISOR_IMAGE ?= orgsdk-supervisor:dev
EXECUTOR_SOURCE_DIR ?= $(CURDIR)/runtime/src

.PHONY: install dev run frontend migrate worker services services-stop executor executor-images executor-rebuild executor-stop test lint format check api-generate api-check frontend-build license-check
install:
	$(UV) sync --locked
	$(NPM) --prefix frontend ci
	cd runtime && bun install --frozen-lockfile
	$(NPM) --prefix frontend run build
dev:
	@test -f .env || cp .env.example .env
	$(MAKE) services
	$(MAKE) migrate
	$(MAKE) executor
	set -a; . ./.runtime/executor.env; set +a; PYTHONUNBUFFERED=1 DJANGO_PORT=$(DJANGO_PORT) FRONTEND_PORT=$(FRONTEND_PORT) DJANGO_PROXY_TARGET=http://127.0.0.1:$(DJANGO_PORT) $(NPM) --prefix frontend run dev:all
run:
	$(UV) run manage.py runserver 127.0.0.1:$(DJANGO_PORT)
frontend:
	$(NPM) --prefix frontend run dev -- --port $(FRONTEND_PORT)
migrate:
	$(UV) run manage.py migrate
services:
	docker compose -f deploy/development.compose.yaml up -d --wait --wait-timeout 60
services-stop:
	docker compose -f deploy/development.compose.yaml --profile execution stop
executor-images:
	@docker image inspect $(EXECUTOR_JOB_IMAGE) >/dev/null 2>&1 || docker build -t $(EXECUTOR_JOB_IMAGE) runtime
	@docker image inspect $(EXECUTOR_SUPERVISOR_IMAGE) >/dev/null 2>&1 || docker build -t $(EXECUTOR_SUPERVISOR_IMAGE) -f runtime/Dockerfile.supervisor runtime
executor: executor-images
	$(UV) run scripts/setup_local_executor.py
	DJANGO_PORT=$(DJANGO_PORT) EXECUTOR_SOURCE_DIR="$(EXECUTOR_SOURCE_DIR)" EXECUTOR_JOB_IMAGE=$(EXECUTOR_JOB_IMAGE) EXECUTOR_SUPERVISOR_IMAGE=$(EXECUTOR_SUPERVISOR_IMAGE) docker compose -f deploy/development.compose.yaml --profile execution up -d --no-build executor
executor-rebuild:
	docker build -t $(EXECUTOR_JOB_IMAGE) runtime
	docker build -t $(EXECUTOR_SUPERVISOR_IMAGE) -f runtime/Dockerfile.supervisor runtime
	$(MAKE) executor
executor-stop:
	docker compose -f deploy/development.compose.yaml --profile execution stop executor
worker:
	DJANGO_SETTINGS_MODULE=config.settings.local $(UV) run python scripts/watch_python.py -- python manage.py run_worker
api-generate:
	$(NPM) --prefix frontend run api:generate
api-check:
	$(NPM) --prefix frontend run api:check
frontend-build:
	$(NPM) --prefix frontend run build
test:
	$(UV) run pytest --cov --cov-report=term-missing
lint:
	$(UV) run ruff check .
	$(UV) run ruff format --check .
format:
	$(UV) run ruff check --fix .
	$(UV) run ruff format .
	$(NPM) --prefix frontend run format
runtime-check:
	cd runtime && bun run check

license-check:
	cmp LICENSE runtime/LICENSE

check: license-check lint runtime-check
	$(UV) lock --check
	$(NPM) --prefix frontend run check
	$(NPM) --prefix frontend run build
	$(UV) run manage.py check
	$(UV) run manage.py makemigrations --check --dry-run
	$(UV) run pytest --cov --cov-report=term-missing
