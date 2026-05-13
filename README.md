# modex-cli

Generate `SKILLS.md` from a corpus, on your own machine.

> **Status:** in development. APIs and CLI surface are not yet stable.

`modex-cli` reads text-based sources — `.txt`, `.md`, PDFs, EPUBs, web pages — and emits structured skill entries to a `SKILLS.md` manifest. The corpus stays on your machine; you supply your own Anthropic API key for extraction.

## Install

Not yet published. Once Phase A lands:

```sh
npx @modex/cli feed ./book.md
```

## Roadmap

See [docs/roadmap.md](docs/roadmap.md).

## SKILLS.md and the wider project

A `SKILLS.md` is a structured, provenance-linked manifest of skills that emerged from a corpus. The schema and this tooling are open (MIT). The [Modex](https://modex.md) registry is one place you can bind a SKILLS.md to claim its history — but binding is optional, and `modex-cli` is useful on its own.

## License

MIT — see [LICENSE](LICENSE).
