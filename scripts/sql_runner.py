#!/usr/bin/env python3
"""
sql_runner.py — shared helpers for the one-shot migration runners.

Provides config loading, DB connection, and a statement-by-statement SQL file
executor with friendly progress output and "already applied" skip handling.
"""
import configparser
import re
import sys
from pathlib import Path

import pymysql

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = REPO_ROOT / "config.ini"


def load_config(path: str | Path = DEFAULT_CONFIG) -> configparser.ConfigParser:
    cfg = configparser.ConfigParser()
    if not cfg.read(path):
        sys.exit(f"Config file not found: {path}")
    return cfg


def connect(cfg: configparser.ConfigParser, **kwargs) -> pymysql.Connection:
    kwargs.setdefault("autocommit", True)
    return pymysql.connect(
        host=cfg["database"]["host"],
        port=int(cfg["database"]["port"]),
        user=cfg["database"]["user"],
        password=cfg["database"]["password"],
        database=cfg["database"]["database"],
        **kwargs,
    )


def parse_statements(sql_path: Path) -> list[str]:
    """Split a .sql file on semicolons, stripping -- comments and blanks."""
    statements = []
    for stmt in sql_path.read_text().split(";"):
        clean = re.sub(r"--[^\n]*", "", stmt).strip()
        if clean:
            statements.append(clean)
    return statements


def run_sql_file(
    conn: pymysql.Connection,
    sql_path: Path,
    skip_codes: tuple[int, ...] = (1060,),
) -> None:
    """Execute each statement in *sql_path*, skipping already-applied errors.

    skip_codes defaults to 1060 (duplicate column); pass (1060, 1054) when a
    rename migration may already have been applied (1054 = unknown column).
    """
    statements = parse_statements(sql_path)
    print(f"Running {len(statements)} statement(s) from {sql_path.name} …\n")

    with conn.cursor() as cur:
        for i, stmt in enumerate(statements, 1):
            m = re.search(r"(ALTER TABLE|UPDATE)\s+(\w+)", stmt, re.IGNORECASE)
            label = f"{m.group(1)} {m.group(2)}" if m else stmt[:60]
            print(f"  [{i}/{len(statements)}] {label} … ", end="", flush=True)
            try:
                cur.execute(stmt)
                print(f"OK  (rows affected: {cur.rowcount})")
            except pymysql.err.OperationalError as e:
                if e.args[0] in skip_codes:
                    print(f"SKIPPED ({e.args[1]})")
                else:
                    print(f"ERROR: {e}")
                    raise
