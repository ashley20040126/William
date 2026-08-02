# Security Policy

## Reporting

Please report security issues privately to the repository owner instead of opening a public issue containing exploit details or credentials.

## Secrets and personal data

- Use only local `.env` files derived from the committed `.env.example` templates.
- Never commit API keys, database passwords, JWT secrets, user uploads, audio, chat exports, database dumps, or generated indexes built from private data.
- Rotate a credential immediately if it is exposed in a commit, log, screenshot, or shared archive.
- Treat voice, mood, journal, memory, and wellbeing records as sensitive personal data.

## Production guidance

- Use unique high-entropy database and JWT secrets.
- Restrict MySQL and algorithm-service ports to trusted networks.
- Disable debug endpoints in production.
- Apply authentication, rate limiting, retention limits, encryption, and access logging appropriate to the deployment.
