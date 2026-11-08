# Security policy

## Supported versions

Iris is pre-1.0. Security fixes go into the latest release on `main`.

| Version | Supported |
| --- | --- |
| 0.1.x | ✅ |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report privately through GitHub:
[**Report a vulnerability**](https://github.com/vthattey/iris/security/advisories/new)
(repository → Security → Advisories → Report a vulnerability).

Please include:

- what an attacker could do, and under what conditions
- steps to reproduce, with a minimal input (Iris JSON, PlantUML/Mermaid, or source files)
- the Iris version, Node.js version and browser, if relevant

You can expect an acknowledgement within a few days. Once the issue is confirmed, a fix and an advisory will
be published, crediting you unless you prefer otherwise.

## Security model

Iris is designed so that diagrams of private code stay private:

- **No network access at view time.** Generated HTML inlines the viewer, layout engine and data, and loads
  nothing from the network.
- **Script-safe embedding.** Diagram data is serialised with `<`, `>`, `&`, U+2028 and U+2029 escaped, so a
  document containing `</script>` or HTML cannot break out of its `<script>` element. Labels are inserted into
  the page as text, never as HTML.
- **Analysis is read-only.** `iris analyze` reads source files and never executes them, builds them or
  installs anything they reference.

Reports about any of these guarantees are especially welcome.
