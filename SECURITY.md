# Security Policy

## Reporting a vulnerability

If you believe you have found a security vulnerability in `backlog` or `backlog-server`, please do **not** open a public GitHub issue.

Instead, report it privately to: **security@lint.to**

Please include:

- a clear description of the issue
- steps to reproduce or a proof of concept
- the version affected (`backlog --version` or `backlog-server` version)
- the impact you think this has

You will receive an acknowledgment within a few business days.

## Supported versions

Security fixes are applied to the latest published release on npm. Older versions are not maintained.

## Dependency advisories

The CI runs npm audit on every push. Moderate or higher advisories are addressed before release.
