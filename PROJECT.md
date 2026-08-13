# SOLAT V2 project boundary

## What this is

SOLAT V2 is the clean foundation for a personal AI assistant and future
creative agent. The first milestone proves one reliable conversation path.

## Milestone 1

Renderer UI -> secure Electron IPC -> SOLAT Core -> configured model provider ->
IPC response -> renderer. The user never manages a port.

## Deliberately not included yet

Search, memory, RAG, music services, slides, creative composition, image
generation, multi-agent planning, queues, Redis/Celery, and compatibility code
from V1. The V1 visual control inventory is retained for UI parity, but these
service layers remain intentionally disconnected until a later milestone.

## V1 boundary

The parent V1 project is retained as an archive/reference. V2 does not import
its backend, database, server routes, or old API contracts.

## GitHub boundary

V2 has its own Git repository and CI workflow. A remote repository must be
selected explicitly before any push; V1's origin is never reused silently.
