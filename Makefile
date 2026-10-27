BUN ?= bun
NPM ?= npm

.PHONY: install dev frontend build test e2e lint typecheck check runtime-check license-check
install:
	$(BUN) install --frozen-lockfile
	$(NPM) --prefix frontend ci
	cd runtime && $(BUN) install --frozen-lockfile

dev:
	$(BUN) --watch server/index.ts

frontend:
	$(NPM) --prefix frontend run dev

build:
	$(BUN) scripts/build.ts

test:
	$(BUN) test server
	$(NPM) --prefix frontend test

e2e:
	$(BUN) scripts/e2e.ts

lint:
	$(NPM) --prefix frontend run lint

typecheck:
	$(BUN) run typecheck
	$(NPM) --prefix frontend run typecheck

runtime-check:
	cd runtime && $(BUN) run check

license-check:
	cmp LICENSE runtime/LICENSE

check: license-check runtime-check
	$(BUN) run format:check
	$(BUN) run typecheck
	$(BUN) test server
	$(NPM) --prefix frontend run check
	$(NPM) --prefix frontend run build
