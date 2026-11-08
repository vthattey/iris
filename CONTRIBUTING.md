# Contributing to Iris

Thanks for helping make large systems easier to understand. Bug reports, fixes, new language extractors,
better importer coverage, viewer improvements and documentation are all welcome.

## Ways to contribute

- **Report a bug** with the [bug template](https://github.com/vthattey/iris/issues/new?template=bug_report.yml).
  A minimal input (a few source files, a PlantUML snippet, or Iris JSON) makes it fast to fix.
- **Suggest a feature** with the [feature template](https://github.com/vthattey/iris/issues/new?template=feature_request.yml).
  The [roadmap](README.md#limitations-and-roadmap) lists what is planned.
- **Improve the docs.** If something confused you, it will confuse the next person too.
- **Send a pull request.** For anything larger than a small fix, please open an issue first so we can agree
  on the approach.

## Development setup

Requirements: Node.js 18.17 or later and Git. No native toolchain is needed.

```bash
git clone https://github.com/vthattey/iris.git
cd iris
npm install
npm test
```

To run the browser test as well:

```bash
npm install --no-save playwright
npx playwright install chromium
npm test
```

Useful commands:

| Command | What it does |
| --- | --- |
| `npm test` | All test suites (the browser test skips itself without Playwright) |
| `npm run examples` | Renders `examples/` and the analyzer fixtures into `out/examples/` |
| `npm run docs:images` | Regenerates the README screenshots and GIF (needs Playwright and ffmpeg) |
| `node bin/iris.js …` | Runs the CLI from the working tree |

## Project layout

See [docs/architecture.md](docs/architecture.md) for a map of the code and how data flows through it. In short:

- `src/analyze/` reads code → neutral type model → diagrams
- `src/import/` turns PlantUML / Mermaid into Iris JSON
- `src/export/` turns Iris JSON into Mermaid
- `viewer/` is the browser code inlined into every HTML file
- `schema/` is the JSON Schema; `src/model/` validates documents

## Common contributions

### Support a new framework in code analysis

1. Add a small fixture under `test/fixtures/` that uses the framework the way real projects do.
2. Extend the extractor (`src/analyze/<lang>.js`) only if it is missing syntax; most framework support lives in
   `src/analyze/build.js` (`entryOf` for entry points, `isBean` for DI, `buildEr` for ORMs, the client sets for
   HTTP, database and messaging calls).
3. Add assertions to `test/analyze.test.js`.
4. Document it in `docs/code-analysis.md` and the README table.

### Add a language

Follow [docs/architecture.md → Adding a language](docs/architecture.md#adding-a-language).

### Change the viewer

- The viewer is plain browser JavaScript (ES5 syntax, standard DOM APIs) with no build step, because it is inlined into each HTML file.
- Check light and dark themes, keyboard toggling and a large diagram (`npm run examples`, then open
  `out/examples/java-monolith.html`).
- Keep `test/viewer.test.js` passing, and extend it for new interactions.

### Change the JSON format

The format is a public contract used by people and agents. Additive, optional fields are fine. Anything that
changes or removes existing fields needs an issue first. Update `schema/iris-diagram.schema.json`,
`docs/json-format.md`, `skill/iris/references/schema-guide.md` and `src/model/kinds.js` together.

## Coding guidelines

- ES modules, Node.js built-ins, and as few dependencies as possible. Every new runtime dependency needs a
  reason in the pull request.
- Prefer small, readable functions over cleverness; comments explain *why*, not *what*.
- Two-space indentation, single quotes, semicolons (see `.editorconfig`).
- User-facing messages: say what went wrong and what to do next.
- Never make generated HTML load anything from the network.

## Pull requests

- Keep each pull request focused on one change.
- Include tests for behaviour changes and update the docs that describe it.
- Add a line to `CHANGELOG.md` under **Unreleased**.
- Write commit messages in the imperative ("Add JAX-RS sub-resource support").
- CI runs the tests on Linux (Node 18, 20, 22), Windows and macOS, plus the browser test. All must pass.

## Code of Conduct

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
