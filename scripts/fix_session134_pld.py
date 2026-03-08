#!/usr/bin/env python3
"""
One-shot fix: re-import the PLD file for session 134 (20260218_015349).
Self-contained — does not import import_resmed.py (avoids root-owned log).
"""
import configparser
import datetime
import zoneinfo
from pathlib import Path

import pymysql
import pyedflib

cfg = configparser.ConfigParser()
cfg.read("/home/jacos/0_opencode/application_resmedData/config.ini")

tz         = zoneinfo.ZoneInfo(cfg.get("display", "timezone", fallback="UTC"))
session_id = 134
prefix     = "20260218_015349"
pld_path   = Path("/home/jacos/00_resmed/DATALOG/20260217/20260218_015349_PLD.edf")
BATCH_SIZE = 1000


def parse_prefix_datetime(prefix: str, tz: zoneinfo.ZoneInfo) -> datetime.datetime:
    """Convert YYYYMMDD_HHMMSS local wall-clock → naive UTC datetime."""
    local_dt = datetime.datetime.strptime(prefix, "%Y%m%d_%H%M%S").replace(tzinfo=tz)
    return local_dt.astimezone(datetime.timezone.utc).replace(tzinfo=None)


def import_pld_direct(cur, session_id, prefix, pld_path, tz):
    reader = pyedflib.EdfReader(
        str(pld_path),
        annotations_mode=pyedflib.DO_NOT_READ_ANNOTATIONS,
    )
    try:
        labels        = reader.getSignalLabels()
        session_start = parse_prefix_datetime(prefix, tz)

        signals = {}
        for i, label in enumerate(labels):
            clean = label.split(".")[0]
            if clean == "Crc16":
                print(f"  Skipping Crc16 signal (index {i})")
                continue
            signals[clean] = reader.readSignal(i).tolist()
    finally:
        reader.close()

    lengths   = [len(v) for v in signals.values()]
    n_samples = min(lengths)
    print(f"  Signals: {list(signals.keys())}")
    print(f"  Lengths: {lengths}  →  n_samples = {n_samples}")

    rows = []
    for idx in range(n_samples):
        offset_s    = idx * 2.0
        sample_time = session_start + datetime.timedelta(seconds=offset_s)
        rows.append((
            session_id,
            prefix,
            sample_time,
            offset_s,
            signals.get("MaskPress", [None] * n_samples)[idx],
            signals.get("Press",     [None] * n_samples)[idx],
            signals.get("EprPress",  [None] * n_samples)[idx],
            signals.get("Leak",      [None] * n_samples)[idx],
            signals.get("RespRate",  [None] * n_samples)[idx],
            signals.get("TidVol",    [None] * n_samples)[idx],
            signals.get("MinVent",   [None] * n_samples)[idx],
            signals.get("Snore",     [None] * n_samples)[idx],
            signals.get("FlowLim",   [None] * n_samples)[idx],
        ))

    for i in range(0, len(rows), BATCH_SIZE):
        cur.executemany(
            """
            INSERT INTO pld_samples
                (session_id, file_prefix, sample_time_utc, offset_s,
                 mask_press_cmh2o, press_cmh2o, epr_press_cmh2o, leak_l_s,
                 resp_rate_bpm, tid_vol_l, min_vent_l_min, snore, flow_lim)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            rows[i: i + BATCH_SIZE],
        )
    return len(rows)


conn = pymysql.connect(
    host=cfg["database"]["host"],
    port=int(cfg["database"]["port"]),
    user=cfg["database"]["user"],
    password=cfg["database"]["password"],
    database=cfg["database"]["database"],
    autocommit=False,
)

with conn.cursor() as cur:
    n = import_pld_direct(cur, session_id, prefix, pld_path, tz)
    print(f"Inserted {n} PLD rows for session {session_id} ({prefix})")

    stat = pld_path.stat()
    cur.execute(
        "INSERT IGNORE INTO import_log (file_path, file_size, file_mtime, imported_at_utc)"
        " VALUES (%s, %s, %s, NOW())",
        (str(pld_path), stat.st_size, stat.st_mtime),
    )

conn.commit()
conn.close()
print("Done.")
