---
name: clean-typescript-react
description: Write clean, self-documenting TypeScript and React code with conventional camelCase file and helper naming, PascalCase components and types, kebab-case for scripts, config, folders, and routes, strict typing, and minimal comments. Use when creating or refactoring files in the repository.
---

# Clean TypeScript & React Conventions

## Naming Conventions
- Use `camelCase` for code files, variables, and functions (for example `tripAssistant.ts`, `destinations.data.ts`, `formatPrice.util.ts`).
- Use `PascalCase` for React component files, types, interfaces, and classes (for example `ProposalCard.tsx`, `ConversationStore`).
- Use `kebab-case` for scripts, configuration files, directory/skill names, and API route paths (for example `.claude/skills/clean-typescript-react/SKILL.md`, `start-dev.sh`, `/api/trip-proposals`).
- Use `UPPER_SNAKE_CASE` for environment variables and true constants.
- Use focused `camelCase` suffixes (such as `.util.ts` or `.service.ts`) only when they clarify a real, scoped role—avoid dumping unrelated functions into generic catch-all files.

## Self-Documenting Code & Comments
- Write clear, intention-revealing names for functions, variables, and types so the code reads naturally without clutter.
- Avoid inline (`//`) or block (`/* */`) comments by default. Keep comments rare and strictly limited to non-obvious constraints, external API quirks, or subtle edge cases (such as Gemini `raw` parts or idempotent action resolution).

## TypeScript & Structure
- Keep strict TypeScript enabled; avoid `any` and unsafe type casts where proper types or validation schemas can be used.
- Keep functions small and focused on a single responsibility, using early returns to keep control flow shallow.
- Keep folder structures flat and practical for the size of the project rather than creating deep or premature abstractions.
