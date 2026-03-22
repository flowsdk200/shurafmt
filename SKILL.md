---
name: shurafmt-hard-rules
description: Hard operating rules for working in the shurafmt bot repository. Use when editing, reversing, scraping, deploying, or debugging anything in this repo, especially plugins and external-site integrations.
---

# Shurafmt Hard Rules

These rules are mandatory for this repository.

## Absolute bans

- Never use headless browsers.
- Never use full browsers, browser automation, Playwright, Puppeteer, Selenium, Chromium dump-dom, DevTools driving, or any equivalent browser execution path.
- Never switch to a browser-based shortcut just because HTTP reverse engineering is hard.
- Never claim a flow is concrete if it has not been verified from actual responses, HTML, JS, or endpoint behavior.

## Required approach

- Reverse sites with direct HTTP requests, HTML parsing, JS analysis, documented APIs, observed payloads, and reproducible endpoint behavior.
- Prefer concrete traces over guesses.
- If a path is blocked or unclear, stop escalating into browser automation and keep working through the non-headless surface.
- Before editing plugins, identify the real data source first.
- Match existing plugin style; do not invent new output patterns without evidence from the repo.

## Preferred scraper toolkit

Use the smallest non-headless tool that fits the target. Do not jump to heavier tooling without a concrete reason.

- `fetch` or simple `axios` for straightforward GET or JSON endpoints.
- `axios` for controlled headers, redirects, binary buffers, timeouts, and manual request shaping.
- `cheerio` for HTML parsing, DOM extraction, and repeatable selector-based scraping.
- `axios-cookiejar-support` plus `tough-cookie` when the target requires cookie continuity, CSRF flow, or multi-step session state.
- `got-scraping` when a normal client is blocked and a browser-like HTTP fingerprint is needed without using a browser.
- `crypto` when a site requires signatures, hashes, nonce generation, HMAC, token derivation, or request verification logic.
- `python` only when it gives a concrete reverse-engineering advantage, such as quick decoding, payload analysis, regex-heavy extraction, or format inspection that is slower or messier in Node.

## Full non-headless scraping toolbox

Prefer tools already present in the repo or built into Node/Python.

### Node transport and request shaping

- `fetch`
- `axios`
- `got-scraping`
- `URL` and `URLSearchParams`
- `AbortController`
- `Buffer`
- request headers, cookies, redirect handling, timeout control, referer/origin shaping

### Node state and session handling

- `axios-cookiejar-support`
- `tough-cookie`
- manual cookie extraction only when a jar is unnecessary
- CSRF token pickup from HTML, meta tags, inline JSON, or previous responses

### Node HTML and data extraction

- `cheerio`
- regex only for narrow markers, never as the first choice for full HTML structure
- inline JSON extraction from script tags
- `JSON.parse` after concrete cleanup, not blind eval

### Node payload and encoding helpers

- `form-data` for multipart flows
- `Buffer` for base64, hex, binary conversion
- `crypto` for md5, sha1, sha256, HMAC, random bytes, nonce generation
- `zlib` when manual gzip, deflate, or brotli handling is needed
- `TextDecoder` and `TextEncoder` for charset-sensitive transforms

### Node response and media inspection

- `file-type`
- stream and buffer inspection
- partial range requests when probing large media
- HEAD requests only when the target actually supports them

### Node JS reverse helpers

- `vm` only for controlled local evaluation of small known snippets when pure parsing is insufficient
- string deobfuscation, packed script inspection, token reconstruction
- never execute remote browser code paths just to avoid reading the logic

### Python helper toolbox

Use Python as an analysis helper when it is concretely faster or cleaner. Prefer stdlib first.

- `urllib.request` or `urllib.parse`
- `re`
- `json`
- `base64`
- `hashlib`
- `hmac`
- `html`
- `gzip`
- `bz2`
- `brotli` only if available
- `subprocess` for quick one-off analysis pipelines

Do not assume third-party Python modules exist. Verify first.

## Scraping workflow ladder

Follow this order unless concrete evidence requires skipping a step.

1. Inspect the page with plain GET and keep the exact URL, status, and markers.
2. Identify whether the real data is in HTML, inline JSON, script config, iframe, XHR endpoint, or secondary host.
3. Reproduce the smallest working request with `fetch` or `axios`.
4. Add `cheerio` only when structural extraction is needed.
5. Add cookies or CSRF handling only when the flow proves it needs state.
6. Add `got-scraping` only when the target is concretely fingerprint-sensitive.
7. Add `crypto` only when the site clearly signs or derives parameters.
8. Use Python only as a helper when Node becomes slower to reason with.
9. Only after the real source is proven, implement or edit the plugin.

## Adaptive tool selection

- Start with the lightest path that can prove the data source.
- Move from `fetch` to `axios` when you need tighter transport control.
- Add `cheerio` only when string matching is no longer reliable enough.
- Add cookie jars only when the target actually depends on persisted cookies.
- Move to `got-scraping` only after normal HTTP clients are concretely blocked or underfitted.
- Use `crypto` only when the target shows real signature, hash, nonce, or encrypted parameter behavior.
- Use Python as an analysis helper, not as a lazy replacement for normal Node scraping flow.
- If a method change is needed, tie it to observed behavior, not instinct.

## Concrete adaptation rules

- If the target serves plain JSON, stay on `fetch` or `axios`; do not drag in DOM parsing.
- If the target only exposes data through HTML cards, use `cheerio`.
- If the page contains embedded state in script tags, extract and parse that state before hunting for hidden endpoints.
- If the page only contains an iframe, treat the iframe host as the real source and move upstream.
- If a request fails only after the first call, suspect cookies, CSRF, or anti-replay state before changing the whole stack.
- If a request differs by signature, timestamp, nonce, or digest, inspect the site JS and derive the exact algorithm.
- If a file host returns HTML first and media later, map the handoff step-by-step instead of guessing the final file URL.
- If a server compresses or chunks oddly, inspect raw headers and decode intentionally.
- If a site mixes multiple mirrors, verify each mirror type separately; do not assume one mirror flow applies to all.
- If metadata and media come from different hosts, treat them as two proven flows and join them only after both are concrete.

## Evidence to capture before coding

- final page URL after redirects
- request method
- query params or form body shape
- required headers
- cookie requirements
- response status
- exact marker proving success
- exact marker proving failure
- whether the data came from HTML, inline JSON, XHR, iframe, or secondary host
- whether metadata and media were resolved from the same source or not

## Scraping proof standard

- Keep the exact URL, headers, payload shape, cookies, and response markers that proved the flow.
- Distinguish clearly between page HTML, AJAX data, embedded JSON, and secondary file hosts.
- If the page only contains an iframe or token, say that explicitly and move to the real upstream source.
- Do not call a path solved until the final metadata or media URL has been verified from actual responses.

## Plugin implementation guardrails

- Do not code around an unknown source.
- Do not hardcode guessed endpoints.
- Do not add fallback text paths to hide a broken media flow.
- Reuse repo dependencies and existing plugin patterns before introducing anything new.
- If a target needs a new dependency, first prove that the current repo tools cannot solve it cleanly.
- Keep extraction helpers separate from send logic when the flow is non-trivial.
- Verify metadata and media independently if the source split is real.

## User constraint priority

- If the user says a method is forbidden, treat it as a hard ban for the task.
- For this repo, headless is permanently forbidden unless the user explicitly removes that ban in clear words.

## When blocked

- Report the exact concrete blocker.
- Preserve findings already proven.
- Do not hide uncertainty behind confident wording.
