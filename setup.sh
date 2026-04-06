#!/bin/bash
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✅ Created .env from .env.example"
  echo "👉 Fill in the required values in .env before running docker compose up"
else
  echo "ℹ️  .env already exists — skipping copy"
fi
