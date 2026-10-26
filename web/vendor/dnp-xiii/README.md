# DNP XIII (vendored)

Copied on 2026-10-26 from agency-hq commit 9b5586d (`reference/dnp-xiii/`), which mirrors the DNP XIII design-system artifact (https://claude.ai/artifact/YNcLF1gPzaPmo2gDqZMYpR).

- `tokens.css`: CSS custom properties. Do not edit here; re-copy from the source.
- `components/bundle.css`: component classes (`n13-*`).

One local change: the Google Fonts `@import` at the top of `bundle.css` is removed. The review page is local-only and makes no third-party requests, so Bangers, Comic Neue and Courier Prime fall back to the system font stack named in the tokens.
