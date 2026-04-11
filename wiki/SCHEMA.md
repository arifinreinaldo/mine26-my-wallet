# Wiki Schema

## Purpose

This wiki is the authoritative knowledge base for AI agents developing mine26-my-wallet.
It captures business rules, edge cases, and invariants that are NOT obvious from reading code alone.

## Conventions

### Page Structure
Every wiki page follows this format:
1. **Title** (H1) — domain concept name
2. **Overview** (1-3 sentences) — what this concept is and why it matters
3. **Rules** — numbered list of business rules / invariants
4. **Edge Cases** — numbered list of non-obvious behaviors
5. **Common Mistakes** — what to avoid (linked to common-bug-patterns.md where relevant)
6. **Related Pages** — cross-references to other wiki pages

### Writing Rules
- State facts, not opinions. Every rule should be verifiable from the code.
- Include the handler/file where a rule is enforced when relevant.
- Use concrete examples (input → output) for edge cases.
- Never duplicate information — cross-reference instead.
- Keep pages under 200 lines. Split if growing beyond that.

### Maintenance
- **Ingest**: When new features are added, update relevant wiki pages and log the change.
- **Query**: When answering questions, check the wiki first. If the answer isn't there, add it after finding it in code.
- **Lint**: Periodically check for contradictions between wiki and code. Code wins — update wiki.

### Cross-References
- Use relative markdown links: `[wallets](wallets.md)`
- When a rule in one page depends on a rule in another, link to the specific section.

### Updating
- After any code change that affects business logic, update the relevant wiki page(s).
- Append a one-line entry to `log.md` with date, page changed, and what changed.
- Update `index.md` if a new page is added or a page summary changes.
