---
name: express-conventions
description: Conventions for the Express server - thin route handlers that delegate to core modules, kebab-case endpoints, one central error middleware with safe status codes, and explicit middleware order. Use when creating or changing Express routes, routers, middleware, or server bootstrap code in the repository.
---

# Express Conventions

## Express Conventions
- Keep route handlers thin: parse request inputs, delegate to core modules (`assistant`, `store`), and map results or domain errors to HTTP responses without business logic in routes.
- Use `kebab-case` for HTTP endpoints and route segments, and keep Express middleware/router file names consistent with the repository's `camelCase` role-suffix pattern.
- Centralize error handling in a single Express error middleware and return clean status codes (`400`, `404`, `409`, `502`/`503`) with safe, non-leaking messages.
- Register JSON parsing, API routes, static SPA serving, and the error middleware in explicit order.
