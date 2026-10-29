BUN ?= bun
NPM ?= npm

.PHONY: install dev frontend build build-npm test e2e lint typecheck check runtime-check license-check
install:
	$(NPM) ci
	$(NPM) --prefix frontend ci
	$(NPM) --prefix runtime ci

dev:
	$(BUN) --watch server/index.ts

frontend:
	$(NPM) --prefix frontend run dev

build:
	$(BUN) scripts/build.ts

build-npm:
	$(NPM) run build:npm

test:
	$(BUN) test server
	$(NPM) --prefix frontend test

e2e:
	$(BUN) scripts/e2e.ts

lint:
	$(BUN) run lint
	$(NPM) --prefix frontend run lint

typecheck:
	$(BUN) run typecheck
	$(NPM) --prefix frontend run typecheck

runtime-check:
	cd runtime && $(BUN) run check

license-check:
	cmp LICENSE runtime/LICENSE

check: license-check runtime-check
	$(NPM) run test:cli
	$(BUN) run check
	$(BUN) test server
	$(NPM) --prefix frontend run check
	$(NPM) --prefix frontend run build
