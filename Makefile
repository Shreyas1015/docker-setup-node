# Operations — run from /opt/docker-setup-node on EC2
COMPOSE := docker compose

.PHONY: help
help:
	@echo "Usage: make <target>"
	@echo ""
	@echo "  build       Build Docker image"
	@echo "  up          Start all services"
	@echo "  down        Stop all services"
	@echo "  restart     Restart app only"
	@echo "  logs        Follow all logs"
	@echo "  logs-app    Follow app logs"
	@echo "  shell       Shell into app container"
	@echo "  db-shell    Connect to external DB"
	@echo "  migrate     Run pending migrations"
	@echo "  seed        Seed database"
	@echo "  backup      Backup database"
	@echo "  health      Check /health endpoint"
	@echo "  status      Container status + resources"
	@echo "  clean       Remove unused containers/images"

.PHONY: build up down restart
build:
	$(COMPOSE) build app

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart app

.PHONY: logs logs-app
logs:
	$(COMPOSE) logs -f --tail=100

logs-app:
	$(COMPOSE) logs -f --tail=100 app

.PHONY: shell db-shell
shell:
	docker exec -it setup_doc_app /bin/sh

db-shell:
	@echo "Using external DB — connect via: psql \$$DATABASE_URL"

.PHONY: migrate seed
migrate:
	$(COMPOSE) run --rm app npx sequelize-cli db:migrate

seed:
	$(COMPOSE) run --rm app node db/seed.js

.PHONY: backup health status clean
backup:
	bash scripts/backup.sh

health:
	@curl -sf http://127.0.0.1/health | jq . || echo "UNHEALTHY"

status:
	@echo "=== Containers ==="
	$(COMPOSE) ps
	@echo ""
	@echo "=== Resources ==="
	docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}"

clean:
	docker container prune -f
	docker image prune -f
