# ResMed Sleep Data Importer

[![Python](https://img.shields.io/badge/python-3.10%2B-blue?logo=python&logoColor=white)](https://www.python.org/)
[![MariaDB](https://img.shields.io/badge/MariaDB-10.6%2B-blue?logo=mariadb&logoColor=white)](https://mariadb.org/)
[![PyMySQL](https://img.shields.io/badge/PyMySQL-1.1%2B-informational?logo=python&logoColor=white)](https://pypi.org/project/PyMySQL/)
[![pyedflib](https://img.shields.io/badge/pyedflib-0.1.22%2B-informational)](https://pypi.org/project/pyEDFlib/)
[![License](https://img.shields.io/badge/license-personal%20use-lightgrey)](./README.md)
[![Data format](https://img.shields.io/badge/data%20format-EDF%20%2F%20EDF%2BD-orange)](https://www.edfplus.info/)
[![Device](https://img.shields.io/badge/device-ResMed%20AirSense%2010%2F11-teal)](https://www.resmed.com/)

ResMed Data Importer imports therapy data from ResMed CPAP/BiPAP devices, parses the raw files, and stores normalized metrics in a MariaDB database. The tool then generates graphs for key indicators such as AHI, leak rate, pressure, and usage trends, making it easier to analyze therapy performance over time.

A Python script that reads **ResMed CPAP SD-card data** and imports it into a **MariaDB** database, preserving all available detail: nightly summaries, scored respiratory events, 2-second therapy metrics, 1-second oximetry, and 25 Hz flow/pressure waveforms.

---

> [!NOTE]
> **The importer and the dashboard are independent components.**
>
> `import_resmed.py` only requires Python, PyMySQL, and a MariaDB database — no Node.js, no containers. You can use the importer on its own to populate the database and query the data directly with SQL tools, without ever running the dashboard. The dashboard (`dashboard/`) is an optional companion that visualises the imported data; it has its own prerequisites and deployment steps described in [§14 Dashboard](#14-dashboard).

---

> [!IMPORTANT]
> **Sleep nights run from noon to noon, not midnight to midnight.**
>
> A "night" in this project is the 24-hour window that starts at **12:00 (noon) on day N** and ends at **12:00 (noon) on day N+1**, measured in the display timezone configured in `config.ini`.
>
> This means a session that starts at **01:30 on Tuesday** belongs to **Monday's night** — because the sleeper went to bed on Monday evening and woke on Tuesday morning. The noon boundary ensures that late-night and early-morning sessions are always grouped under the correct date.
>
> Every session row in the database carries a `night_date` column (type `DATE`) that encodes this boundary. All dashboard views, SQL queries, and aggregations group by `night_date`, **not** by the calendar date of `session_start_utc`.
>
> See [§6 Configuration](#6-configuration), [§8 Database Schema — sleep_sessions](#table-sleep_sessions), and [§13 FAQ](#13-faq) for further detail.

---

<a name="toc"></a>

## Table of Contents

1. [Overview](#1-overview)
2. [Supported Devices and Data](#2-supported-devices-and-data)
3. [Prerequisites](#3-prerequisites)
4. [Installation](#4-installation)
5. [Database Setup](#5-database-setup)
6. [Configuration](#6-configuration)
7. [Usage](#7-usage)
8. [Database Schema](#8-database-schema)
9. [Data Source Reference](#9-data-source-reference)
10. [Logging](#10-logging)
11. [Performance Notes](#11-performance-notes)
12. [Troubleshooting](#12-troubleshooting)
13. [FAQ](#13-faq)
14. [Dashboard](#14-dashboard)
15. [Glossary](#15-glossary)

---

## 1. Overview

ResMed CPAP/APAP/BiPAP machines write detailed therapy data to an SD card. When you copy the SD card to a folder on your computer, you get a tree of **EDF (European Data Format)** files. This script parses every file type in that tree and loads the data into a relational database so you can query, analyse, and visualise it with standard SQL tools.

### What the script does

- Reads the master daily summary file (`STR.edf`) and populates a `daily_summary` table — one row per therapy day, containing every statistical column the machine records (AHI, leak percentiles, pressure percentiles, SpO2, ventilation, humidifier stats, device settings, fault flags).
- Walks the `DATALOG/` directory tree, groups files by session, and imports four additional data streams per session:
  - **Scored respiratory events** (hypopneas, obstructive apneas, central apneas, etc.)
  - **2-second therapy metrics** (mask pressure, leak, respiratory rate, tidal volume, minute ventilation, snore index, flow limitation)
  - **1-second oximetry** (SpO2%, pulse rate) — only when an oximeter was attached
  - **25 Hz flow and pressure waveforms** — the raw breath-by-breath signal at 40 ms resolution
- Tracks every imported file in an `import_log` table so re-running the script after copying new SD card data only processes the new files.
- Logs all activity to `import_resmed.log` in the same directory as the script.

[↑ Back to ToC](#toc)

---

## 2. Supported Devices and Data

### Confirmed working

The script has been developed and tested against data from **ResMed AirSense 10 / AirSense 11** series machines. The SD card format is consistent across:

| Device family | Examples |
|---|---|
| AirSense 10 | AirSense 10 AutoSet, AirSense 10 Elite, AirSense 10 CPAP |
| AirSense 11 | AirSense 11 AutoSet, AirSense 11 AutoSet for Her |
| AirCurve 10 | AirCurve 10 VAuto, AirCurve 10 S, AirCurve 10 ASV |

### SD card folder structure

After copying the SD card, the folder should look like this:

```
<datalog_root>/
├── STR.edf              ← master daily summary (one record per day)
├── Identification.tgt   ← device serial / model info (not imported)
├── Journal.dat          ← binary journal (not imported)
├── SETTINGS/            ← device config snapshots (not imported)
└── DATALOG/
    ├── 20240111/        ← one directory per calendar day
    │   ├── 20240111_222904_CSL.edf   ← session summary
    │   ├── 20240111_222904_EVE.edf   ← scored events
    │   ├── 20240111_222910_BRP.edf   ← 25 Hz waveforms
    │   ├── 20240111_222911_PLD.edf   ← 2-second metrics
    │   ├── 20240111_222911_SAD.edf   ← 1-second oximetry
    │   └── *.crc                     ← checksum files (ignored)
    ├── 20240112/
    │   ├── 20240112_215821_CSL.edf
    │   ├── 20240112_215821_EVE.edf
    │   ├── 20240112_215827_BRP.edf
    │   ├── 20240112_215827_PLD.edf
    │   ├── 20240112_215827_SAD.edf
    │   ├── 20240113_025022_BRP.edf   ← segment from past midnight
    │   ├── 20240113_025022_PLD.edf
    │   └── 20240113_025022_SAD.edf
    └── …
```

**Key observations:**
- Each therapy night can produce multiple `BRP`/`PLD`/`SAD` file groups (one per mask-on segment). Only the first segment of the night has a matching `CSL`/`EVE` pair.
- Session filenames are `YYYYMMDD_HHMMSS_TYPE.edf`. The timestamp encodes the **actual start time** of the recording segment. Sessions that begin before midnight are stored in that day's directory even if they cross midnight.
- The `DATALOG/` directory contains one subdirectory per **calendar day** (based on the device's clock at midnight), not per sleep session.

[↑ Back to ToC](#toc)

---

## 3. Prerequisites

| Requirement | Version |
|---|---|
| Python | 3.10 or newer |
| MariaDB | 10.6 or newer (MySQL 8.0+ also works) |
| pyedflib | 0.1.22 or newer |
| PyMySQL | 1.1.0 or newer |

[↑ Back to ToC](#toc)

---

## 4. Installation

### 1. Clone / copy the script files

```bash
git clone <repo-url> resmed-importer
cd resmed-importer
```

Or simply copy the three files (`import_resmed.py`, `config.ini`, `requirements.txt`) into a working directory.

### 2. Create a Python virtual environment (recommended)

```bash
python3 -m venv .venv
source .venv/bin/activate      # Linux / macOS
# .venv\Scripts\activate       # Windows
```

### 3. Install Python dependencies

```bash
pip install -r requirements.txt
```

[↑ Back to ToC](#toc)

---

## 5. Database Setup

### Create the database and user

Connect to MariaDB as root (or another admin user) and run:

```sql
CREATE DATABASE IF NOT EXISTS resmed_sleep
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'resmed'@'localhost'
    IDENTIFIED BY 'your_strong_password_here';

GRANT SELECT, INSERT, UPDATE, CREATE, INDEX, REFERENCES
    ON resmed_sleep.*
    TO 'resmed'@'localhost';

FLUSH PRIVILEGES;
```

> **Note:** `REFERENCES` is required because the script creates foreign-key constraints.  
> The script creates all tables automatically on first run — you do not need to run any DDL manually.

### Recommended MariaDB settings

For best performance when importing the large `brp_samples` table, add these to `my.cnf` / `my.ini`:

```ini
[mysqld]
innodb_buffer_pool_size = 2G        # increase if you have RAM to spare
innodb_log_file_size    = 512M
innodb_flush_log_at_trx_commit = 2  # slight durability trade-off for speed
bulk_insert_buffer_size = 256M
```

Restart MariaDB after changing `my.cnf`.

[↑ Back to ToC](#toc)

---

## 6. Configuration

Copy `config.ini.example` and fill in your values:

```bash
cp config.ini.example config.ini
nano config.ini
```

### Full `config.ini` reference

```ini
[database]
# Hostname or IP address of the MariaDB server
host     = localhost

# TCP port (default MariaDB port is 3306)
port     = 3306

# Database user created in step 5
user     = resmed

# Password for the database user
password = your_strong_password_here

# Name of the database created in step 5
database = resmed_sleep

[paths]
# Absolute path to the root of the ResMed SD card export.
# This directory must contain STR.edf and a DATALOG/ subdirectory.
# Example (Linux/macOS): /media/user/SDCARD
# Example (Windows):     C:\Users\User\Desktop\ResMed
datalog_root = /path/to/resmed/sdcard

[import]
# Optional date limits — only sessions whose DATALOG directory date falls
# within this range will be imported.  Format: YYYY-MM-DD.  Both limits are
# inclusive.  Leave blank to import all available data.
date_from =
date_to   =

[display]
# IANA timezone name used to determine sleep-night boundaries and for display.
# All timestamps are stored in UTC in the database; this timezone is applied
# only when computing night_date (the noon-to-noon boundary) and in the
# dashboard UI.
# Examples: UTC, Africa/Johannesburg, America/New_York, Europe/London
timezone = Africa/Johannesburg
```

### `[display] timezone` and the noon-to-noon night boundary

> [!NOTE]
> The `timezone` setting has a direct effect on which calendar date a session is assigned to.

The device records session start times in **local wall-clock time** (as set on the machine). The importer converts these to **UTC** for storage, then uses `[display] timezone` to assign each session to a `night_date`.

The formula is:

```
night_date = DATE( session_start (in display timezone) − 12 hours )
```

| Session start (local) | timezone | Subtracted 12 h | `night_date` |
|---|---|---|---|
| 2026-03-08 23:15 (SAST) | Africa/Johannesburg | 2026-03-08 11:15 | **2026-03-08** |
| 2026-03-09 01:30 (SAST) | Africa/Johannesburg | 2026-03-08 13:30 | **2026-03-08** |
| 2026-03-09 11:59 (SAST) | Africa/Johannesburg | 2026-03-08 23:59 | **2026-03-08** |
| 2026-03-09 12:01 (SAST) | Africa/Johannesburg | 2026-03-09 00:01 | **2026-03-09** |

So any session starting before noon on Tuesday is attributed to Monday's night. Any session starting at noon or later on Tuesday opens a new night labelled Tuesday.

If you change `timezone` after importing data, you must recompute `night_date` for all existing rows:

```sql
UPDATE sleep_sessions
SET night_date = DATE(
    CONVERT_TZ(session_start_utc, '+00:00', '<your-offset>') - INTERVAL 12 HOUR
)
WHERE archived_at_utc IS NULL;
```

Replace `<your-offset>` with the fixed UTC offset for your timezone (e.g. `+02:00` for SAST, `-05:00` for EST). Named timezone identifiers (`Africa/Johannesburg`) only work if the MariaDB timezone tables are populated — use a fixed offset string to be safe.

### `[import]` date limits

The `date_from` and `date_to` keys let you restrict which nights are imported without touching any other configuration.

| Key | Required | Default | Description |
|---|---|---|---|
| `date_from` | No | *(blank — no lower bound)* | First date to import, inclusive |
| `date_to` | No | *(blank — no upper bound)* | Last date to import, inclusive |

**Examples:**

Import only January 2026:
```ini
[import]
date_from = 2026-01-01
date_to   = 2026-01-31
```

Import everything from a specific date onwards (open-ended upper bound):
```ini
[import]
date_from = 2026-03-01
date_to   =
```

Import everything up to and including a specific date (open-ended lower bound):
```ini
[import]
date_from =
date_to   = 2026-02-28
```

**How filtering is applied:**

- The DATALOG day-directory name (`YYYYMMDD`) is compared against the limits. Entire directories outside the range are skipped before any file is read.
- `STR.edf` daily-summary records are filtered by the `summary_date` value stored in each record, so the same limits apply to `daily_summary` rows as well.
- A session that starts before midnight and spills past midnight is stored in the *start* day's directory — that directory date is what is compared against the limits.
- **The filter is advisory for new imports only.** Rows already in the database from a previous import are not deleted when you tighten the range.
- An invalid date format (anything other than `YYYY-MM-DD`) causes the script to exit immediately with a `CRITICAL` log message.

[↑ Back to ToC](#toc)

---

## 7. Usage

### Basic invocation

```bash
python import_resmed.py --config config.ini
```

### With a custom config path

```bash
python import_resmed.py --config /home/user/my_resmed_config.ini
```

### First run

On the first run the script will:

1. Create all six database tables (if they don't exist).
2. Parse `STR.edf` and insert one row per therapy day into `daily_summary`.
3. Walk every `DATALOG/YYYYMMDD/` directory, group files by session timestamp, and import each session's events, metrics, oximetry, and waveforms.
4. Record every imported file in `import_log`.

Progress is printed to the console and logged in detail to `import_resmed.log`.

### Incremental re-runs (after copying new SD card data)

Simply run the same command again. The script checks `import_log` before processing each file. Files that were already imported are skipped — only new sessions are processed.

```
2026-01-15 09:00:01  INFO      STR.edf already imported — skipping
2026-01-15 09:00:01  INFO      Found 400 day directories in DATALOG
2026-01-15 09:00:02  INFO      ...
2026-01-15 09:00:15  INFO      Sessions skipped (done)     : 380
2026-01-15 09:00:15  INFO      Sessions imported           : 5
```

### Re-importing everything from scratch

To force a full re-import, truncate the `import_log` table:

```sql
TRUNCATE TABLE import_log;
```

Then re-run the script.

### Command-line help

```bash
python import_resmed.py --help
```

```
usage: import_resmed.py [-h] [--config FILE]

Import ResMed SD-card sleep data into MariaDB.

options:
  -h, --help     show this help message and exit
  --config FILE  Path to the configuration file (default: config.ini)
```

[↑ Back to ToC](#toc)

---

## 8. Database Schema

> **Convention:** All timestamp columns are stored in **UTC** and carry a `_utc` suffix. Soft-delete lifecycle columns (`created_at_utc`, `archived_at_utc`) are present on every table; rows are never hard-deleted.

---

### Table: `import_log`

Tracks every imported EDF file. Used to make the script idempotent — re-running will skip already-imported files.

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED | Auto-increment primary key |
| `file_path` | VARCHAR(1024) | Absolute path to the EDF file |
| `file_size` | BIGINT UNSIGNED | File size in bytes at time of import |
| `file_mtime` | DOUBLE | File modification timestamp (Unix epoch float) |
| `imported_at_utc` | DATETIME | When the file was imported (UTC) |

---

### Table: `daily_summary`

One row per therapy day. Sourced from `STR.edf`. This is the primary table for high-level sleep analysis (AHI trends, leak trends, pressure graphs, etc.).

#### Session timing columns

| Column | Unit | Description |
|---|---|---|
| `id` | — | Auto-increment primary key |
| `summary_date` | DATE | The therapy date (unique key) |
| `duration_min` | minutes | Total therapy duration |
| `on_duration_min` | minutes | Time the mask was actually on |
| `patient_hours` | hours | Cumulative device usage since setup |
| `mask_events` | count | Number of mask-on/off events in the night |

#### Apnea-Hypopnea Index columns

| Column | Unit | Description |
|---|---|---|
| `ahi` | events/hr | Apnea-Hypopnea Index (combined) |
| `ai` | events/hr | Total Apnea Index |
| `hi` | events/hr | Hypopnea Index |
| `oai` | events/hr | Obstructive Apnea Index |
| `cai` | events/hr | Central Apnea Index |
| `uai` | events/hr | Unclassified Apnea Index |
| `csr` | minutes | Cheyne-Stokes Respiration duration |

#### Pressure columns

| Column | Unit | Description |
|---|---|---|
| `mask_press_50` | cmH₂O | Mask pressure 50th percentile |
| `mask_press_95` | cmH₂O | Mask pressure 95th percentile |
| `mask_press_max` | cmH₂O | Mask pressure maximum |
| `tgt_ipap_50` / `tgt_ipap_95` / `tgt_ipap_max` | cmH₂O | Target IPAP (BiPAP) percentiles |
| `tgt_epap_50` / `tgt_epap_95` / `tgt_epap_max` | cmH₂O | Target EPAP (BiPAP) percentiles |
| `blow_press_95` / `blow_press_5` | cmH₂O | Blower pressure 95th / 5th percentile |

#### Flow columns

| Column | Unit | Description |
|---|---|---|
| `flow_95` / `flow_5` | L/s | Flow 95th / 5th percentile |
| `blow_flow_50` | L/min | Blower flow median |

#### Leak columns

| Column | Unit | Description |
|---|---|---|
| `leak_50` | L/s | Leak rate 50th percentile |
| `leak_70` | L/s | Leak rate 70th percentile |
| `leak_95` | L/s | Leak rate 95th percentile |
| `leak_max` | L/s | Leak rate maximum |

#### Ventilation columns

| Column | Unit | Description |
|---|---|---|
| `min_vent_50` / `min_vent_95` / `min_vent_max` | L/min | Minute ventilation percentiles |
| `resp_rate_50` / `resp_rate_95` / `resp_rate_max` | bpm | Respiratory rate percentiles |
| `tid_vol_50` / `tid_vol_95` / `tid_vol_max` | L | Tidal volume percentiles |

#### Oximetry columns

| Column | Unit | Description |
|---|---|---|
| `spo2_50` | % | SpO2 median |
| `spo2_95` | % | SpO2 95th percentile |
| `spo2_max` | % | SpO2 maximum |
| `spo2_thresh_min` | minutes | Time SpO2 was below threshold |

> **Note:** SpO2 columns will be `NULL` if no pulse oximeter was attached.

#### Humidifier / climate columns

| Column | Unit | Description |
|---|---|---|
| `amb_humidity_50` | mg/L | Ambient humidity median |
| `hum_temp_50` | °C | Humidifier temperature median |
| `htube_temp_50` | °C | Heated tube temperature median |
| `htube_pow_50` | % | Heated tube power median |
| `hum_pow_50` | % | Humidifier power median |

#### Device settings columns

| Column | Description |
|---|---|
| `mode` | Therapy mode code (0=CPAP, 1=AutoSet, etc.) |
| `s_ramp_enable` / `s_ramp_time_min` | Ramp enable flag and duration |
| `s_c_start_press` / `s_c_press` | Fixed CPAP pressure settings |
| `s_epr_clin_enable` / `s_epr_enable` / `s_epr_level` / `s_epr_type` | EPR (Expiratory Pressure Relief) settings |
| `s_as_comfort` / `s_as_start_press` / `s_as_min_press` / `s_as_max_press` | AutoSet pressure range settings |
| `s_smart_start` | SmartStart enabled flag |
| `s_pt_access` / `s_ab_filter` / `s_mask` / `s_tube` | Accessory and filter settings |
| `s_climate_control` / `s_hum_enable` / `s_hum_level` | Humidifier settings |
| `s_temp_enable` / `s_temp` | Climate temperature settings |
| `heated_tube` / `humidifier` | Heated tube and humidifier hardware flags |
| `fault_device` / `fault_alarm` / `fault_humidifier` / `fault_heated_tube` | Fault flag codes |

#### Metadata columns

| Column | Description |
|---|---|
| `created_at_utc` | Row creation timestamp (UTC) |
| `updated_at_utc` | Last update timestamp (UTC), auto-updated on change |
| `archived_at_utc` | Soft-delete timestamp; `NULL` = active |

---

### Table: `sleep_sessions`

One row per therapy session (per `CSL` file). All other detail tables reference this table via `session_id`.

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED | Auto-increment primary key |
| `session_start_utc` | DATETIME | Session start timestamp (UTC) |
| `session_end_utc` | DATETIME | Session end timestamp (UTC), derived from last BRP sample |
| `day_dir` | DATE | The `DATALOG/YYYYMMDD` directory date (UTC calendar date of session start) |
| `night_date` | DATE | **Sleep-night date** — see note below |
| `file_prefix` | VARCHAR(15) | `YYYYMMDD_HHMMSS` unique session key |
| `session_duration_s` | INT | Pre-computed session duration in seconds (`MAX(brp_samples.offset_ms) / 1000`) |
| `session_leak_95` | DECIMAL(8,4) | Pre-computed p95 leak rate from `pld_samples.leak_l_s` for this session |
| `created_at_utc` | DATETIME | Row creation timestamp (UTC) |
| `archived_at_utc` | DATETIME | Soft-delete timestamp; `NULL` = active |

> [!NOTE]
> **`night_date` uses a noon-to-noon boundary in the display timezone.**
>
> It is computed as:
> ```sql
> DATE( CONVERT_TZ(session_start_utc, '+00:00', '<tz-offset>') - INTERVAL 12 HOUR )
> ```
> A session starting at 01:30 local time on Tuesday gets `night_date = Monday` because subtracting 12 hours gives Monday 13:30. The noon cutoff means that anyone who falls asleep Monday night and wakes Tuesday morning is always grouped under Monday's night — regardless of whether the session crosses midnight.
>
> All dashboard views, trend charts, and per-night aggregations group by `night_date`.
> The timezone offset used is determined by `[display] timezone` in `config.ini`.

---

### Table: `events`

One row per scored respiratory event from `EVE` files.

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED | Auto-increment primary key |
| `session_id` | BIGINT UNSIGNED | Foreign key → `sleep_sessions.id` |
| `file_prefix` | VARCHAR(15) | Session prefix (denormalized for easy queries) |
| `event_time_utc` | DATETIME | Absolute UTC timestamp of the event onset |
| `offset_s` | FLOAT | Seconds from session start |
| `duration_s` | FLOAT | Event duration in seconds |
| `event_type` | VARCHAR(64) | One of: `Hypopnea`, `Obstructive Apnea`, `Central Apnea`, `Unclassified Apnea`, `RERA`, `Recording starts` |
| `created_at_utc` | DATETIME | Row creation timestamp (UTC) |
| `archived_at_utc` | DATETIME | Soft-delete timestamp; `NULL` = active |

---

### Table: `pld_samples`

One row per 2-second interval from `PLD` files. These are the primary high-resolution therapy metrics.

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED | Auto-increment primary key |
| `session_id` | BIGINT UNSIGNED | Foreign key → `sleep_sessions.id` |
| `file_prefix` | VARCHAR(15) | Session prefix (denormalized for easy queries) |
| `sample_time_utc` | DATETIME(3) | Absolute timestamp (2s resolution, UTC) |
| `offset_s` | FLOAT | Seconds from session start |
| `mask_press_cmh2o` | FLOAT | Mask pressure (cmH₂O) |
| `press_cmh2o` | FLOAT | Device (blower) pressure (cmH₂O) |
| `epr_press_cmh2o` | FLOAT | EPR-adjusted pressure (cmH₂O) |
| `leak_l_s` | FLOAT | Unintentional leak rate (L/s) |
| `resp_rate_bpm` | FLOAT | Respiratory rate (bpm) |
| `tid_vol_l` | FLOAT | Tidal volume (L) |
| `min_vent_l_min` | FLOAT | Minute ventilation (L/min) |
| `snore` | FLOAT | Snore index (dimensionless, higher = more snoring) |
| `flow_lim` | FLOAT | Flow limitation index (0–1, higher = more obstruction) |
| `created_at_utc` | DATETIME | Row creation timestamp (UTC) |
| `archived_at_utc` | DATETIME | Soft-delete timestamp; `NULL` = active |

---

### Table: `sad_samples`

One row per second from `SAD` files. Only populated when a compatible pulse oximeter was attached.

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED | Auto-increment primary key |
| `session_id` | BIGINT UNSIGNED | Foreign key → `sleep_sessions.id` |
| `file_prefix` | VARCHAR(15) | Session prefix (denormalized for easy queries) |
| `sample_time_utc` | DATETIME(3) | Absolute timestamp (1s resolution, UTC) |
| `offset_s` | INT | Seconds from session start |
| `spo2_pct` | FLOAT | Blood oxygen saturation (%) |
| `pulse_bpm` | FLOAT | Pulse rate (bpm) |
| `created_at_utc` | DATETIME | Row creation timestamp (UTC) |
| `archived_at_utc` | DATETIME | Soft-delete timestamp; `NULL` = active |

---

### Table: `brp_samples`

One row per 40 milliseconds (25 Hz) from `BRP` files. This is the raw breath-by-breath waveform.

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED | Auto-increment primary key |
| `session_id` | BIGINT UNSIGNED | Foreign key → `sleep_sessions.id` |
| `file_prefix` | VARCHAR(15) | Session prefix (denormalized for easy queries) |
| `sample_time_utc` | DATETIME(3) | Absolute timestamp (40ms resolution, UTC) |
| `offset_ms` | INT | Milliseconds from session start |
| `flow_l_s` | FLOAT | Instantaneous flow rate (L/s, positive = inhale) |
| `pressure_cmh2o` | FLOAT | Instantaneous pressure (cmH₂O) |
| `created_at_utc` | DATETIME | Row creation timestamp (UTC) |
| `archived_at_utc` | DATETIME | Soft-delete timestamp; `NULL` = active |

---

### Table: `brp_samples_1s`

1-second aggregated buckets derived from `brp_samples`. Populated by `scripts/aggregate_brp.py` (not the main importer). Used by the dashboard waveform viewer to render long sessions without querying the full 25 Hz table.

| Column | Type | Description |
|---|---|---|
| `id` | BIGINT UNSIGNED | Auto-increment primary key |
| `session_id` | BIGINT UNSIGNED | Foreign key → `sleep_sessions.id` |
| `sample_time_utc` | DATETIME(3) | Bucket start timestamp (1s resolution, UTC) |
| `offset_s` | INT | Seconds from session start |
| `flow_min` | FLOAT | Flow minimum in bucket (L/s) |
| `flow_max` | FLOAT | Flow maximum in bucket (L/s) |
| `flow_mean` | FLOAT | Flow mean in bucket (L/s) |
| `press_min` | FLOAT | Pressure minimum in bucket (cmH₂O) |
| `press_max` | FLOAT | Pressure maximum in bucket (cmH₂O) |
| `press_mean` | FLOAT | Pressure mean in bucket (cmH₂O) |
| `created_at_utc` | DATETIME | Row creation timestamp (UTC) |
| `archived_at_utc` | DATETIME | Soft-delete timestamp; `NULL` = active |

---

### Table: `users`

Dashboard authentication accounts. Managed separately from the importer — not populated by `import_resmed.py`.

| Column | Type | Description |
|---|---|---|
| `id` | INT UNSIGNED | Auto-increment primary key |
| `username` | VARCHAR(64) | Unique login username |
| `password_hash` | VARCHAR(255) | bcrypt hash of the user's password |
| `display_name` | VARCHAR(128) | Optional display name shown in the UI |
| `created_at_utc` | DATETIME | Row creation timestamp (UTC) |
| `archived_at_utc` | DATETIME | Soft-delete timestamp; `NULL` = active |

---

### Entity-Relationship overview

```
daily_summary      (1 per day, from STR.edf)
     │
     │  (linked conceptually by date, no FK)
     │
sleep_sessions     (1 per CSL file)
     ├─── events          (N per session, from EVE)
     ├─── pld_samples     (N per session, 1 per 2s, from PLD)
     ├─── sad_samples     (N per session, 1 per 1s, from SAD)
     ├─── brp_samples     (N per session, 1 per 40ms, from BRP)
     └─── brp_samples_1s  (N per session, 1 per 1s, aggregated by scripts/aggregate_brp.py)

users  (standalone — dashboard auth only)
```

[↑ Back to ToC](#toc)

---

## 9. Data Source Reference

| EDF file | Format | Table(s) populated | Notes |
|---|---|---|---|
| `STR.edf` | EDF (continuous) | `daily_summary` | 80 signals × 1 record per day; raw header parsing required (non-compliant dimensions) |
| `*_CSL.edf` | EDF+D (discontinuous) | `sleep_sessions` | Annotations not meaningful for import; file presence marks session start |
| `*_EVE.edf` | EDF+D (discontinuous) | `events` | TAL-encoded annotations: onset, duration, event type |
| `*_BRP.edf` | EDF (continuous) | `brp_samples` | 2 signals: `Flow.40ms` (L/s) and `Press.40ms` (cmH₂O) at 25 Hz |
| `*_PLD.edf` | EDF (continuous) | `pld_samples` | 9 signals at 0.5 Hz (every 2 seconds) |
| `*_SAD.edf` | EDF (continuous) | `sad_samples` | 2 signals at 1 Hz: `SpO2.1s` and `Pulse.1s`; skipped if all values are −1 |

### EDF+D annotation format

`EVE` and `CSL` files use the EDF+D (discontinuous) variant. The time-stamped annotation list (TAL) is stored as raw bytes in the `EDF Annotations` signal channel:

```
+<onset_seconds>\x15<duration_seconds>\x14<annotation_text>\x14\x00
```

- `\x15` separates onset from duration (and doubles as a negative-sign marker when it precedes the onset)
- `\x14` separates fields within one annotation
- `\x00` terminates each data record

Example byte sequence for an obstructive apnea at 6 hours 12 minutes 51 seconds lasting 12 seconds:

```
+22371\x1512\x14Obstructive Apnea\x14\x00
```

[↑ Back to ToC](#toc)

---

## 10. Logging

### Log file location

`import_resmed.log` is written in the **same directory as `import_resmed.py`**. The file is opened in **append mode** — each run adds to the existing log rather than overwriting it.

### Log levels

| Level | What it means |
|---|---|
| `INFO` | Normal progress: config loaded, DB connected, day started, session imported, final summary |
| `WARNING` | Non-fatal issues: STR.edf missing, SAD file skipped (no oximeter), empty session |
| `ERROR` | Recoverable failures: corrupt EDF header, DB insert failure for one session; script continues |
| `CRITICAL` | Fatal startup failures: bad config, cannot connect to DB; script exits immediately |

### Console vs log file

- The **console** (`stdout`) shows `INFO` and above — brief progress only.
- The **log file** shows `DEBUG` and above — full detail including skipped files and stack traces for errors.

### Sample log output (normal run)

```
2026-01-15 08:00:00  INFO      ============================================================
2026-01-15 08:00:00  INFO      ResMed import started
2026-01-15 08:00:00  INFO      Log file: /home/user/resmed/import_resmed.log
2026-01-15 08:00:00  INFO      Config loaded from config.ini
2026-01-15 08:00:00  INFO      Connected to MariaDB resmed@localhost/resmed_sleep
2026-01-15 08:00:00  INFO      Database tables verified / created
2026-01-15 08:00:01  INFO      Parsing STR.edf (/data/resmed/STR.edf) …
2026-01-15 08:00:02  INFO      daily_summary: 421 rows upserted from STR.edf
2026-01-15 08:00:02  INFO      Found 786 day directories in DATALOG
2026-01-15 08:45:00  INFO      Import complete
2026-01-15 08:45:00  INFO        daily_summary rows upserted : 421
2026-01-15 08:45:00  INFO        Days processed              : 785
2026-01-15 08:45:00  INFO        Sessions imported           : 910
2026-01-15 08:45:00  INFO        Sessions skipped (done)     : 0
2026-01-15 08:45:00  INFO        Events inserted             : 4231
2026-01-15 08:45:00  INFO        PLD rows inserted           : 7432100
2026-01-15 08:45:00  INFO        SAD rows inserted           : 0
2026-01-15 08:45:00  INFO        BRP rows inserted           : 1872430000
2026-01-15 08:45:00  INFO        Errors logged               : 0
```

When date limits are active, two additional lines appear near the top:

```
2026-01-15 08:00:00  INFO      Date limits active: 2026-01-01 → 2026-01-31
2026-01-15 08:00:01  INFO      Scanning 31 day directories (filtered 2026-01-01 → 2026-01-31, skipped 755)
```

### Sample error log entry

```
2026-01-15 08:12:34  ERROR     BRP open error /data/resmed/DATALOG/20240223/20240224_004445_BRP.edf:
                               the file is not EDF(+) or BDF(+) compliant (Number of Datarecords)
Traceback (most recent call last):
  ...
OSError: .../20240224_004445_BRP.edf: the file is not EDF(+) or BDF(+) compliant (Number of Datarecords)
```

[↑ Back to ToC](#toc)

---

## 11. Performance Notes

### Expected data volumes (typical one-year dataset)

| Table | Estimated rows | Approximate size |
|---|---|---|
| `daily_summary` | ~365 | < 1 MB |
| `sleep_sessions` | ~1,000 | < 1 MB |
| `events` | ~5,000 | < 1 MB |
| `pld_samples` | ~8,000,000 | ~1.5 GB |
| `sad_samples` | varies (0 if no oximeter) | varies |
| `brp_samples` | ~2,000,000,000 | ~150–200 GB |

> **Warning:** The `brp_samples` table is extremely large. A full year of nightly data at 25 Hz yields roughly **2 billion rows**. Ensure your MariaDB data directory has sufficient disk space before importing.

### Import speed

- `daily_summary` (STR.edf): seconds
- `events` + `pld_samples` per session: < 1 second per session
- `brp_samples` (25 Hz waveforms): the bottleneck — expect **30–90 minutes** for a full year depending on disk I/O and MariaDB buffer pool size

### Index recommendations

The script creates the minimum indexes needed for foreign-key integrity and common time-range queries. For analytical workloads consider adding:

```sql
-- Find all events of a given type within a date range
ALTER TABLE events ADD INDEX idx_events_type_time (event_type, event_time);

-- Fast AHI trend queries
ALTER TABLE daily_summary ADD INDEX idx_ds_ahi (summary_date, ahi);

-- SpO2 desaturation queries
ALTER TABLE sad_samples ADD INDEX idx_sad_spo2 (session_id, spo2_pct);

-- Flow/pressure queries by session
ALTER TABLE brp_samples ADD INDEX idx_brp_sess_offset (session_id, offset_ms);
```

### Partitioning for brp_samples

For very large deployments, consider range-partitioning `brp_samples` by year:

```sql
ALTER TABLE brp_samples
    PARTITION BY RANGE (YEAR(sample_time)) (
        PARTITION p2024 VALUES LESS THAN (2025),
        PARTITION p2025 VALUES LESS THAN (2026),
        PARTITION p2026 VALUES LESS THAN (2027),
        PARTITION p_future VALUES LESS THAN MAXVALUE
    );
```

[↑ Back to ToC](#toc)

---

## 12. Troubleshooting

### `Config file not found`

```
CRITICAL  Config file not found: config.ini
```

**Fix:** Pass the explicit path with `--config`:

```bash
python import_resmed.py --config /full/path/to/config.ini
```

---

### `Cannot connect to database`

```
CRITICAL  Cannot connect to database: (2003, "Can't connect to MySQL server on 'localhost'")
```

**Fixes:**
- Check that MariaDB is running: `systemctl status mariadb`
- Verify `host`, `port`, `user`, `password` in `config.ini`
- Confirm the database exists: `SHOW DATABASES;` in the MariaDB shell
- Check the user has access: `SHOW GRANTS FOR 'resmed'@'localhost';`

---

### `datalog_root does not exist`

```
CRITICAL  datalog_root does not exist: /path/to/resmed/sdcard
```

**Fix:** Update `datalog_root` in `config.ini` to point to the folder that contains `STR.edf` and `DATALOG/`.

---

### Invalid date in `[import]` section

```
CRITICAL  Config [import] date_from is not a valid YYYY-MM-DD date: '01/01/2026'
```

**Fix:** Use the `YYYY-MM-DD` format exactly (four-digit year, two-digit month and day, separated by hyphens):

```ini
date_from = 2026-01-01
```

---

### `No module named 'pyedflib'` or `No module named 'pymysql'`

**Fix:** Install dependencies:

```bash
pip install -r requirements.txt
```

If you're using a virtual environment, make sure it's activated first.

---

### `The file is discontinuous and cannot be read`

This is normal — it is printed at `DEBUG` level (visible only in the log file, not the console). `EVE` and `CSL` files are EDF+D (discontinuous) format, which `pyedflib` refuses to open with its standard reader. The script handles these files with a custom raw-byte parser and this message does not indicate an error.

---

### `the file is not EDF(+) or BDF(+) compliant`

```
ERROR     BRP open error .../20240224_004445_BRP.edf:
          the file is not EDF(+) or BDF(+) compliant (Number of Datarecords)
```

Some files on the SD card are written partially (e.g. machine turned off mid-session, power failure). These files are logged as errors and skipped. The rest of the import continues normally.

---

### Duplicate key errors on re-run

If you see `Duplicate entry` errors in the log, the `import_log` table may have been truncated or the database was reset. The script uses `INSERT IGNORE` for `import_log` and `ON DUPLICATE KEY UPDATE` for `daily_summary`, so duplicate key errors in those tables are harmless. For `events`, `pld_samples`, `sad_samples`, and `brp_samples`, the script only inserts a session's data if the session's files were **not** in `import_log` — so these tables should not receive duplicates unless `import_log` was cleared.

To safely re-import from scratch:

```sql
TRUNCATE TABLE brp_samples;
TRUNCATE TABLE sad_samples;
TRUNCATE TABLE pld_samples;
TRUNCATE TABLE events;
TRUNCATE TABLE sleep_sessions;
TRUNCATE TABLE daily_summary;
TRUNCATE TABLE import_log;
```

---

### The import runs but no data appears

Check that `datalog_root` points to the correct directory. It must be the **root** of the SD card copy — the directory that directly contains `STR.edf` and the `DATALOG/` folder. Do **not** point it at the `DATALOG/` subdirectory itself.

[↑ Back to ToC](#toc)

---

## 13. FAQ

**Q: Why does a session starting on Tuesday appear under Monday's night?**  
A: Sleep nights are defined as noon-to-noon in the display timezone. If you fell asleep Monday evening and the session file timestamp is Tuesday 01:30, the system subtracts 12 hours (giving Monday 13:30) and uses the date portion — Monday. This keeps the full sleep episode under a single night label regardless of when you crossed midnight. See [§6 Configuration — timezone](#display-timezone-and-the-noon-to-noon-night-boundary) for the full formula and a worked example.

---

**Q: Does this script modify the original SD card data?**  
A: No. The script only reads from the `datalog_root` path. Nothing is written to the source files.

**Q: Can I run this while the machine is in use?**  
A: Yes — the import reads existing files and the machine does not stream data in real time over a network. Copy the SD card contents to a local folder first, then run the import. Never pull the card from a running machine.

**Q: My machine is an older ResMed S9. Will this work?**  
A: Possibly, but not guaranteed. The S9 uses a different version of the SD card format (different signal labels, different file naming). The script was developed for the AirSense 10/11 format. S9 files may parse partially or not at all.

**Q: I have multiple users / machines. Can I import both into the same database?**  
A: The current schema does not include a `device_id` or `patient_id` column. For a single-user setup this is fine. For multi-user support you would need to add a `device_serial` column to each table and update the insert statements accordingly.

**Q: How do I query last night's AHI?**
```sql
SELECT summary_date, ahi, oai, cai, hi, duration_min
FROM daily_summary
ORDER BY summary_date DESC
LIMIT 1;
```

**Q: How do I find all obstructive apnea events in the last 30 days?**
```sql
SELECT e.event_time, e.duration_s, s.session_start
FROM events e
JOIN sleep_sessions s ON s.id = e.session_id
WHERE e.event_type = 'Obstructive Apnea'
  AND e.event_time >= NOW() - INTERVAL 30 DAY
ORDER BY e.event_time;
```

**Q: How do I get the average leak and AHI per month?**
```sql
SELECT
    DATE_FORMAT(summary_date, '%Y-%m')  AS month,
    ROUND(AVG(ahi),    2)               AS avg_ahi,
    ROUND(AVG(leak_95), 3)              AS avg_leak_95_l_s,
    COUNT(*)                            AS nights
FROM daily_summary
WHERE duration_min > 60
GROUP BY month
ORDER BY month;
```

**Q: The BRP import is too slow / I don't need waveforms. Can I skip it?**  
A: The script currently always imports BRP files. To skip BRP, edit `import_resmed.py` and remove (or comment out) the block:

```python
# 5. BRP — 25 Hz waveforms
if "BRP" in files:
    n = import_brp(cur, session_id, prefix, files["BRP"])
    stats["brp_rows"] += n
```

You can also remove the `brp_samples` table from `DDL_STATEMENTS` if you never plan to use it.

[↑ Back to ToC](#toc)

---

## 14. Dashboard

The project ships a **Next.js web dashboard** (`dashboard/`) that visualises the imported data in real time. It connects directly to the same MariaDB database and is served as a containerised service via rootless Podman + systemd (Quadlet).

### Pages

| Page | Route | Default period | Description |
|---|---|---|---|
| **Summary** | `/dashboard` | 30 days | Stat cards (Avg AHI, Avg Usage, Compliance, Avg Leak p95) plus an AHI trend chart |
| **Trends** | `/dashboard/trends` | 90 days | Multi-panel line charts: AHI & apnea indices, pressure, leak, and respiration metrics |
| **Events** | `/dashboard/events` | 90 days | Table of scored respiratory events with session context |
| **Sessions** | `/dashboard/sessions` | — | List of all therapy sessions |
| **Night detail** | `/dashboard/nights/[date]` | — | Per-session metrics and waveform viewer for a single night |

### Time-range dropdown

The **Summary** and **Trends** pages include a dropdown to change the look-back window. The available options are:

| Days | Approximate period |
|---|---|
| 7 | 1 week |
| 14 | 2 weeks |
| 30 | 1 month |
| 60 | 2 months |
| 90 | 3 months |
| 120 | 4 months |
| 150 | 5 months |
| 180 | 6 months |
| 270 | 9 months |
| 360 | 1 year |
| 540 | 1.5 years |
| 720 | 2 years |
| 900 | 2.5 years |
| 1080 | 3 years |

The selection is persisted in the URL query string (`?days=N`), so bookmarks and shared links retain the chosen period. Values outside the valid set fall back to the page default.

### Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15, React 19, Tailwind CSS, shadcn/ui |
| Runtime | Node.js 20 (production container) / Bun (build) |
| Database access | Drizzle ORM over MariaDB |
| Auth | NextAuth.js (credentials provider) |
| Container | Rootless Podman, Quadlet systemd units |

### Environment variables

The dashboard reads the following variables at runtime (set in `deploy/resmed.env`):

| Variable | Description |
|---|---|
| `DB_HOST` | MariaDB hostname |
| `DB_PORT` | MariaDB port (default `3306`) |
| `DB_USER` | Database user |
| `DB_PASSWORD` | Database password |
| `DB_NAME` | Database name |
| `NEXTAUTH_URL` | Full public URL of the dashboard (e.g. `http://localhost:4567`) |
| `NEXTAUTH_SECRET` | Random secret string for session signing |

Copy `deploy/resmed.env.example` to `deploy/resmed.env` and fill in your values before deploying.

### Building and running

#### Build the container image

```bash
podman build -t localhost/resmed-web:latest -f dashboard/Containerfile .
```

#### Start via systemd (Quadlet)

The Quadlet unit files live in `~/.config/containers/systemd/`. Start the pod and web service:

```bash
systemctl --user start resmed-pod.service
systemctl --user start resmed-web.service
```

#### Rebuild and restart after code changes

```bash
podman build -t localhost/resmed-web:latest -f dashboard/Containerfile .
systemctl --user stop resmed-web.service resmed-pod.service
systemctl --user start resmed-pod.service
systemctl --user start resmed-web.service
```

#### Check service status

```bash
systemctl --user status resmed-web.service
```

#### View live logs

```bash
journalctl --user -u resmed-web.service -f
```

[↑ Back to ToC](#toc)

---

## 15. Glossary

For definitions of all medical terms, device acronyms, signal names, and data-format concepts used throughout this project, see **[GLOSSARY.md](./GLOSSARY.md)**.

[↑ Back to ToC](#toc)

---

## License

This project is provided as-is for personal use. No warranty is expressed or implied.
