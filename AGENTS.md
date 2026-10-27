# Development checks

- Follow `CONTRIBUTING.md`: use an issue-linked feature branch and pull request targeting `main`. Keep unrelated changes separate. Do not push directly to main, merge, publish or deploy without authorization.
- Use Bun 1.4 for the server and runtime, and npm in `frontend/`. Run `make install`, `make check`, `make e2e`, and `make build` as appropriate. Browser tests use an isolated temporary data directory. Never point test fixtures at a personal installation.
- Next.js owns the static application, account and setup pages. Bun serves the static export and owns REST, tRPC, MCP, SQLite, authentication and maintenance. Keep frontend types and API behavior aligned; do not treat historical Django-generated OpenAPI files as a live contract.
- Preserve Tailwind conventions and established product UI. Protect navigation context and unsaved edits. Shared browser tasks follow the workspace `orgsdk-browser` instructions.
- SQLite writes use short immediate transactions. Executors communicate over HTTP only and never access the product database. Network calls must not run inside write transactions.

# Product boundaries

- Local product: projects have persistent executor folders; external clients own reasoning and conversations. Plugins are external and project-owned. Do not add hosted billing, cloud provisioning or bundled integrations.
- Workspace hostnames select a registered workspace and membership authorizes access. Scope every query and related resource. Enforce permissions in the server, not only the frontend.
- Executor capabilities are scoped to immutable run snapshots. Current project grants further constrain access; changes cannot widen existing snapshots. Keep credentials, registration secrets and approvals outside job authority.
- Preserve immutable action versions, test and validation isolation, protocol compatibility, third-party license notices and runtime vendor provenance.
- Fresh Bun databases are a separate format. Refuse existing Django databases and do not modify personal installations or retained data without explicit direction. Snapshot SQLite safely and preserve encryption keys and executor data separately.
