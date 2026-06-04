# Backup and Disaster Recovery Runbook

## Purpose

This document defines backup, replication, restore, and disaster recovery procedures for Commerce POS and the School Application platform.

The goal is to protect:

- Financial transactions
- Student balances
- Wallet ledgers
- Inventory data
- Audit events
- User accounts
- Application configuration

---

# Current State

Current implementation:

- Single PostgreSQL primary database
- Persistent Docker volume
- Financial operations executed in atomic transactions
- Append-only wallet ledger entries
- Migration locking using PostgreSQL advisory locks

Current limitations:

- No database replication
- No automatic failover
- No Point-in-Time Recovery (PITR)
- Single point of failure

---

# Target Production Architecture

```text
                    Proxmox Cluster

VM: db-primary
    PostgreSQL Primary
            ↓
    Streaming Replication
            ↓
VM: db-replica
    PostgreSQL Standby

            ↓
        WAL Archive
            ↓

VM: minio-storage
    S3-compatible object storage

            ↓

Nightly Proxmox Backup
```

---

# Recovery Objectives

## Recovery Point Objective (RPO)

Maximum acceptable data loss:

```text
< 1 minute
```

Target mechanism:

- PostgreSQL streaming replication
- Continuous WAL archive

---

## Recovery Time Objective (RTO)

Maximum acceptable downtime:

```text
< 15 minutes
```

Target mechanism:

- Replica promotion
- PITR restore

---

# Data Retention Policy

| Data Type | Retention |
|------------|-----------|
| WAL Archives | 30 days |
| Full Database Backups | 90 days |
| Transaction Records | Indefinite |
| Audit Events | Indefinite |
| Application Logs | 90 days |
| Loki Logs | 30–180 days |

---

# Database Strategy

PostgreSQL is the authoritative source of truth.

Rules:

1. Financial writes occur only in PostgreSQL
2. Do not write transactions to multiple databases
3. Do not use Loki as permanent storage
4. Audit data remains append-only
5. Transaction data must never be deleted

---

# PostgreSQL Configuration

Example settings:

```conf
wal_level = replica
archive_mode = on
archive_command = 'wal-g wal-push %p'
max_wal_senders = 10
archive_timeout = 60
```

---

# Backup Components

## Full Database Backup

Frequency:

```text
Daily
```

Contents:

- Database schema
- Data
- Roles
- Permissions

Storage:

```text
MinIO S3 Bucket
```

Retention:

```text
90 Days
```

---

## WAL Archive Backup

Frequency:

```text
Continuous
```

Contents:

- PostgreSQL Write Ahead Logs

Storage:

```text
MinIO S3 Bucket
```

Retention:

```text
30 Days
```

Purpose:

Allows Point-in-Time Recovery.

---

## VM Backups

Frequency:

```text
Nightly
```

Targets:

- db-primary
- db-replica
- observability VM
- MinIO VM

Storage:

Proxmox Backup Server

Retention:

```text
30 days
```

---

# Audit Event Requirements

All critical actions must generate audit records.

Required events:

```text
student.balance.adjusted
wallet.credit
wallet.debit
inventory.updated
refund.processed
payment.created
payment.completed
payment.failed
user.role.changed
login.failed
```

Recommended schema:

```sql
CREATE TABLE audit_events (

    id UUID PRIMARY KEY,

    event_type TEXT,

    actor_id UUID,

    entity_type TEXT,

    entity_id UUID,

    previous_data JSONB,

    new_data JSONB,

    created_at TIMESTAMPTZ DEFAULT now()

);
```

Rules:

- Never update audit records
- Never delete audit records
- Use append-only behavior

---

# Logging and Observability

Operational logs:

- API logs
- Container logs
- System logs
- PostgreSQL logs
- Proxmox logs

Platform:

- Grafana
- Loki
- Prometheus
- Alertmanager

Rules:

Loki is:

- Searchable
- Alertable
- Temporary

Loki is NOT:

- Permanent transaction storage
- Financial system of record

---

# Monitoring Alerts

Database:

- Replication stopped
- Database unavailable
- High WAL generation
- Disk usage > 80%
- Backup failure

Application:

- Failed transactions exceed threshold
- Refund rate spike
- Login failures spike
- Missing transaction events

Infrastructure:

- Proxmox node down
- WAN offline
- ZFS degraded
- MinIO unavailable

---

# Disaster Recovery Procedures

## Scenario: Primary Database Failure

Symptoms:

- Application cannot write
- PostgreSQL unavailable

Procedure:

1. Verify primary failure
2. Confirm replica health
3. Promote replica

Example:

```bash
pg_ctl promote
```

4. Redirect application connection
5. Validate application functionality

Expected downtime:

```text
< 15 minutes
```

---

## Scenario: Accidental Data Deletion

Symptoms:

- Missing transactions
- Missing student balances

Procedure:

1. Determine deletion timestamp

Example:

```text
2026-05-16 10:42:33 UTC
```

2. Restore latest backup
3. Replay WAL logs
4. Stop replay before deletion point
5. Validate restored data

---

## Scenario: Failed Migration

Symptoms:

- Application errors after deployment

Procedure:

1. Stop application containers
2. Restore latest backup
3. Replay WAL logs if necessary
4. Roll back deployment
5. Investigate migration issue

---

# Monthly Restore Validation

Backup success alone is insufficient.

Monthly checklist:

- Restore latest backup
- Replay WAL archive
- Start application
- Execute health checks
- Verify student balances
- Verify transaction totals
- Verify audit events
- Verify login functionality

Document results after each test.

---

# Future Improvements

Planned upgrades:

- Patroni for HA PostgreSQL
- Automatic failover
- External S3 replication
- Immutable backup storage
- Cross-site replication
- Read replicas for reporting

---

# Developer Cross-Machine Workflow

## Why Copying the Project Folder Is Not Enough

The database lives in a Docker named volume (`commerce_pos_postgres`), not inside the
project directory. Copying or cloning the repo does not copy your data. Orders,
wallets, customers, and all transactions stay on the machine where Docker created the
volume.

Volume location on the host:

```text
/var/lib/docker/volumes/commerce_pos_postgres/_data
```

---

## Export Data from Your Current Machine

Make sure the `db` container is running, then dump the database:

```bash
docker exec commerce_pos-db-1 pg_dump -U commerce_pos commerce_pos > ~/commerce_pos_backup.sql
```

If you are unsure of the container name:

```bash
docker ps --filter "ancestor=postgres:16-alpine"
```

Use the name shown in the `NAMES` column.

---

## Transfer the Dump to the Other Machine

Any method works — AirDrop, USB drive, Google Drive, or scp:

```bash
# From Mac to Linux over the network
scp ~/commerce_pos_backup.sql user@LINUX_IP:~/projects/commerce_pos/

# From Linux to Mac over the network
scp ~/projects/commerce_pos/commerce_pos_backup.sql user@MAC_IP:~/Desktop/
```

---

## Import Data on the Target Machine

1. Start only the database container:

```bash
docker compose up -d db
```

2. Wait a few seconds for it to be healthy, then restore:

```bash
cat ~/projects/commerce_pos/commerce_pos_backup.sql | \
  docker exec -i commerce_pos-db-1 psql -U commerce_pos -d commerce_pos
```

3. Bring the full stack up:

```bash
docker compose up
```

Your orders, wallets, and all data will be available.

---

## Recommended Habit When Switching Machines

Before stopping work on machine A:

```bash
docker exec commerce_pos-db-1 pg_dump -U commerce_pos commerce_pos > \
  ~/projects/commerce_pos/local_dev_backup_$(date +%Y%m%d).sql
```

Keep that file inside the project directory so it travels with the repo (it is
git-ignored by default since `.sql` dump files are not committed). Drop old dumps
periodically to save disk space.

---

# Design Principles

1. PostgreSQL is the source of truth
2. Logs are not databases
3. Audit trails are append-only
4. Backups are useless without restore testing
5. Financial transactions require consistency before availability
6. Recovery plans must be documented and repeatable