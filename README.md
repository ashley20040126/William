# William

William is a privacy-minded personal AI companion for emotional awareness, memory, planning, voice interaction, and contextual support.

> This project is an experimental application, not a medical device or a substitute for professional mental-health care.

## What is included

- React + TypeScript + Vite frontend
- Node.js + Express + MySQL backend
- RAG and structured mental-support knowledge services
- Speech transcription and voice-signal analysis service
- Docker and deployment configuration
- Product, architecture, local-development, deployment, and testing documentation
- Smoke tests and deterministic prompt/memory audits

## Repository layout

```text
.
├── Development/
│   ├── frontend/       # React application
│   ├── backend/        # Express API and MySQL schema
│   ├── docs/           # Product and engineering documentation
│   └── tests/          # Smoke, audit, and review tooling
├── william_algorithm/
│   ├── rag/            # Digital Expert RAG service
│   ├── voice/          # Transcription and audio analysis
│   └── django_expert_bot/
├── docker/             # Algorithm-service images
└── docker-compose.yml
```

## Quick start

Requirements: Node.js 18+, npm 9+, MySQL 8+, Python 3.10+, Docker, and Docker Compose.

```bash
git clone https://github.com/ashley20040126/William.git
cd William

# Configure the backend
cp Development/backend/.env.example Development/backend/.env
# Edit the new .env and add your own database credentials and API keys.

# Install and start the backend
cd Development/backend
npm install
npm run db:init
npm run dev
```

In a second terminal:

```bash
cd Development/frontend
npm install
npm run dev
```

For the RAG and voice services, copy `.env.docker.example` to `.env.docker`, add your own keys, then run:

```bash
docker compose up -d --build
```

The default local endpoints are frontend `http://localhost:3000`, backend `http://localhost:3001`, RAG `http://127.0.0.1:8010`, and voice `http://127.0.0.1:8020`.

## Documentation

- [Full project overview](Development/README.md)
- [Local development](Development/docs/LOCAL_DEV.md)
- [Deployment](Development/docs/DEPLOYMENT.md)
- [Product requirements](Development/docs/PRD.md)
- [Data model and user journey](Development/docs/ER_USER_JOURNEY.md)
- [Testing](Development/docs/testing.md)
- [Algorithm services](william_algorithm/README.md)

## Tests

```bash
cd Development
./tests/smoke/all.sh
```

The smoke suite expects the relevant local services and test database to be running. Additional prompt, memory, and review scripts are documented in [Development/README.md](Development/README.md).

## Public-release exclusions

This public snapshot intentionally excludes secrets, local environments, dependency folders, uploads, databases, generated vector indexes, demo media, and third-party/raw expert corpora. Supply your own authorized corpus and generate indexes locally before using corpus-backed Digital Expert modes.

Only example environment files are committed. Never commit `.env`, `.env.docker`, API keys, user uploads, or database dumps.

## License

The algorithm subproject includes its existing [Apache License 2.0](william_algorithm/LICENSE). No additional license is granted for other repository content unless a file states otherwise.
