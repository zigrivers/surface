# Security Policy

## Supported Versions

Surface is pre-1.0. Security fixes are applied to the latest published version.

## Reporting a Vulnerability

Report vulnerabilities privately to the repository maintainers before public disclosure. Include:

- affected package and version
- reproduction steps
- observed impact
- any relevant logs with secrets removed

Do not include captured UI content, credentials, tokens, auth-state paths, or other sensitive target data in public issues.

## Data Boundary

Surface is local-first. Without configured model credentials, it runs measured-only and does not transmit captured UI data to model providers. Any release or CI workflow must preserve this default.

