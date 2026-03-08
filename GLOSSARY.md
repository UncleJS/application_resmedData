# Glossary of Terms

Definitions for medical, device, and data-format terminology used throughout this project.

---

## A

**AHI — Apnea-Hypopnea Index**  
The primary measure of sleep-disordered breathing severity. Counts the total number of apneas and hypopneas per hour of therapy. Severity bands: Normal < 5, Mild 5–14, Moderate 15–29, Severe ≥ 30.

**AI — Apnea Index**  
The number of apneas (obstructive + central + unclassified) per hour, excluding hypopneas.

**APAP — Automatic Positive Airway Pressure**  
A device mode (also called AutoSet on ResMed machines) where the machine automatically adjusts the therapy pressure breath-by-breath in response to detected events. Contrast with fixed-pressure CPAP.

**Apnea**  
A complete cessation of airflow lasting ≥ 10 seconds. Classified as obstructive, central, or unclassified depending on the detected cause. See also: *Obstructive Apnea*, *Central Apnea*.

---

## B

**BiPAP — Bilevel Positive Airway Pressure**  
A therapy mode that delivers two distinct pressures: a higher IPAP during inhalation and a lower EPAP during exhalation. Used for patients who cannot tolerate continuous pressure, or who require ventilatory support. See also: *IPAP*, *EPAP*.

**BRP — Breath (Waveform) file**  
The `*_BRP.edf` file produced by the ResMed device. Contains raw flow and pressure waveforms sampled at **25 Hz** (one sample every 40 ms). The highest-resolution data stream available from the device. Stored in the `brp_samples` table.

**brp_samples**  
Database table holding 25 Hz (40 ms) raw waveform data. Columns: `flow_l_s` (L/s, positive = inhalation) and `pressure_cmh2o` (cmH₂O). Expect ~2 billion rows per year of nightly data.

**brp_samples_1s**  
Pre-aggregated 1-second summary of `brp_samples`, computed by `aggregate_brp.py`. Stores per-second min, max, and mean of flow and pressure. Used by the "Flow & Pressure Waveform (1s overview)" chart on the session detail page.

---

## C

**CAI — Central Apnea Index**  
Central apneas per hour. A central apnea occurs when the brain temporarily stops sending the signal to breathe; the airway itself is open. Elevated CAI can indicate heart failure or neurological issues.

**Central Apnea**  
Cessation of airflow caused by a failure of respiratory drive (brain does not send the breathing signal) rather than airway obstruction. The device detects this by observing absent effort while flow is zero.

**cmH₂O — Centimetres of Water**  
The unit used for CPAP therapy pressure. 1 cmH₂O ≈ 0.098 kPa ≈ 0.014 psi. Typical therapeutic pressures range from 4 to 20 cmH₂O.

**CPAP — Continuous Positive Airway Pressure**  
A therapy mode where the machine delivers a single fixed pressure continuously throughout the night. The pressurised airflow acts as a pneumatic splint that keeps the upper airway open.

**Crc16**  
An internal checksum signal written into every ResMed EDF file (BRP, PLD, SAD). It has far fewer samples than the therapy signals (one per EDF data-record, not one per measurement interval) and is not meaningful for analysis. The importer skips it.

**CSL — Session Summary file**  
The `*_CSL.edf` file that marks the start of a therapy session. Its presence in a DATALOG directory is used to anchor the session timestamp. The annotations it contains are not imported.

**CSR — Cheyne-Stokes Respiration**  
A cyclical breathing pattern (crescendo–decrescendo flow followed by central apnea) associated with heart failure. Reported in the `daily_summary` table as `csr` in minutes per night.

---

## D

**daily_summary**  
Database table with one row per therapy day, sourced from `STR.edf`. The primary table for trend analysis: AHI, leak percentiles, pressure percentiles, SpO2, compliance, and device settings.

**DATALOG**  
The subdirectory on the ResMed SD card that holds per-session EDF files, organised into one subdirectory per calendar day (`YYYYMMDD/`).

---

## E

**EDF — European Data Format**  
A standard file format for multichannel biosignal data. ResMed uses standard EDF for continuous signals (BRP, PLD, SAD) and EDF+D for discontinuous annotated signals (CSL, EVE).

**EDF+D — European Data Format Plus, Discontinuous**  
An extension of EDF that supports time-stamped annotations and discontinuous recordings. ResMed uses this for `CSL` and `EVE` files. The annotations are encoded as TAL (Time-stamped Annotation Lists) in a dedicated signal channel.

**EPAP — Expiratory Positive Airway Pressure**  
The lower of the two pressures delivered by a BiPAP device, applied during exhalation. Prevents airway collapse at the end of a breath.

**EPR — Expiratory Pressure Relief**  
A ResMed comfort feature that briefly reduces pressure during exhalation to make breathing out against the airflow easier. The degree of relief (0–3 cmH₂O) is set in the device. The `epr_press_cmh2o` column in `pld_samples` shows the EPR-adjusted pressure.

**EVE — Events file**  
The `*_EVE.edf` file containing EDF+D annotations for every scored respiratory event in a session (hypopneas, apneas, RERAs, etc.). Stored in the `events` table.

**events**  
Database table with one row per scored respiratory event. Key columns: `event_type`, `event_time` (UTC), `offset_s` (seconds from session start), `duration_s`.

---

## F

**file_prefix**  
The `YYYYMMDD_HHMMSS` portion of an EDF filename. Used as the unique session key throughout the database. All EDF files belonging to the same therapy segment share the same prefix (or a prefix within a few seconds, due to device behaviour).

**Flow limitation**  
A partial airway obstruction that does not fully stop airflow but causes a flattening of the inspiratory flow waveform. Reported as `flow_lim` in `pld_samples` (dimensionless index 0–1; higher = more limited). Elevated flow limitation can precede hypopneas.

**flow_l_s**  
Instantaneous flow rate in litres per second, as stored in `brp_samples`. Positive values = inhalation, negative values = exhalation.

---

## H

**HI — Hypopnea Index**  
Hypopneas per hour of therapy.

**Humidifier**  
A heated water chamber attached to the CPAP machine that adds moisture to the delivered air, reducing dryness and congestion. Settings (`s_hum_*`) and status are stored in `daily_summary`.

**Hypopnea**  
A partial reduction in airflow (typically ≥ 30% reduction lasting ≥ 10 seconds) accompanied by either an oxygen desaturation or an arousal. Less severe than an apnea but still disrupts sleep quality.

---

## I

**import_log**  
Database table that tracks every successfully imported EDF file (path, size, modification time). Used to make the importer idempotent: subsequent runs skip files already recorded here.

**IPAP — Inspiratory Positive Airway Pressure**  
The higher of the two pressures delivered by a BiPAP device, applied during inhalation. Supports the respiratory muscles and keeps the airway open.

---

## L

**Leak / Unintentional Leak**  
Air escaping from around the mask seal rather than flowing through the patient's airway. Reported in L/s. Distinguish from *intentional leak* (designed into full-face mask exhalation ports). The `leak_l_s` column in `pld_samples` and `leak_*` columns in `daily_summary` measure unintentional leak only. High leak degrades therapy effectiveness.

---

## M

**Mask pressure**  
The air pressure measured at the mask interface, in cmH₂O. Slightly lower than device pressure due to tubing resistance. Stored as `mask_press_cmh2o` in `pld_samples` and as `mask_press_*` percentiles in `daily_summary`.

**Minute ventilation**  
The total volume of air moved per minute, in L/min. Equals tidal volume × respiratory rate. Stored as `min_vent_l_min` in `pld_samples` and as `min_vent_*` percentiles in `daily_summary`. Low minute ventilation can indicate hypoventilation.

---

## O

**OAI — Obstructive Apnea Index**  
Obstructive apneas per hour.

**Obstructive Apnea**  
Cessation of airflow caused by collapse of the upper airway (throat muscles relaxing during sleep), while respiratory effort continues. The most common type of sleep apnea.

**offset_ms / offset_s**  
The number of milliseconds or seconds elapsed since `session_start`. Used to position each sample within a session without storing an absolute timestamp on every row. The absolute time is reconstructed as `session_start + offset`.

---

## P

**Percentile (50th, 95th, max)**  
Statistical summaries of a signal over the night. The 50th percentile (median) represents typical behaviour; the 95th percentile captures the upper end without being influenced by brief spikes. ResMed reports leak, pressure, SpO2, and ventilation using these percentiles in `daily_summary`.

**PLD — Polysomnographic-Like Data file**  
The `*_PLD.edf` file containing nine therapy metrics sampled every **2 seconds**: mask pressure, device pressure, EPR pressure, leak, respiratory rate, tidal volume, minute ventilation, snore index, and flow limitation. Stored in the `pld_samples` table.

**pld_samples**  
Database table with one row per 2-second interval. The primary source for the "Pressure, Leak & Events" chart on the session detail page.

**Pressure relief**  
See *EPR*.

**Pulse oximeter / SpO2 clip**  
An optional accessory that measures blood oxygen saturation and pulse rate from a finger clip. When attached, its data is stored in the `SAD` file. If absent, all SpO2 and pulse values are the sentinel value −1 and the `sad_samples` table receives no rows for that session.

---

## R

**Ramp**  
A comfort feature where the device starts at a low pressure and gradually increases to the therapeutic pressure over a set time (e.g. 20 minutes), giving the patient time to fall asleep before full pressure is applied. Stored as `s_ramp_enable` and `s_ramp_time` in `daily_summary`.

**RERA — Respiratory Effort-Related Arousal**  
A sequence of breaths with increasing effort that ends in an arousal from sleep, without meeting the criteria for apnea or hypopnea. RERAs contribute to sleep fragmentation and can appear in the `events` table.

**Respiratory rate**  
Breaths per minute, stored as `resp_rate_bpm` in `pld_samples` and as `resp_rate_*` percentiles in `daily_summary`. Normal sleeping respiratory rate is approximately 12–20 bpm.

---

## S

**SAD — SpO2/Arterial Desaturation file**  
The `*_SAD.edf` file containing 1-second oximetry data: `SpO2.1s` (blood oxygen %) and `Pulse.1s` (heart rate bpm). Only written when a compatible pulse oximeter is attached. Stored in the `sad_samples` table.

**sad_samples**  
Database table with one row per second of oximetry data. Empty for sessions where no oximeter was connected (all SpO2 values are the sentinel −1).

**Session**  
One continuous mask-on period. Starts when the device detects the mask is on (CSL file) and ends when the mask is removed. A single night may contain multiple sessions if the mask is taken off and put back on. Each session has a unique `file_prefix` and a row in `sleep_sessions`.

**sleep_sessions**  
Database table with one row per therapy session. The parent table for all per-session data (events, pld_samples, sad_samples, brp_samples). Key columns: `session_start` (UTC), `day_dir` (the DATALOG calendar date), `file_prefix`.

**SmartStart**  
A ResMed feature that automatically starts therapy when the machine detects that the mask is on and the patient begins breathing. Stored as `s_smart_start` in `daily_summary`.

**Snore index**  
A dimensionless measure of snoring intensity derived from high-frequency pressure oscillations in the flow waveform. Stored as `snore` in `pld_samples`. Higher values indicate more snoring; the scale is device-internal and not in standard units.

**SpO2 — Peripheral Oxygen Saturation**  
The percentage of haemoglobin in the blood that is carrying oxygen, measured non-invasively by a pulse oximeter. Normal sleeping SpO2 is ≥ 95%. Values below 88–90% are clinically significant. Stored in `sad_samples` and summarised in `daily_summary`.

**STR.edf**  
The master daily summary file on the ResMed SD card. Contains one EDF data-record per therapy day, with ~80 signals covering every statistical summary the device computes. Imported into the `daily_summary` table.

---

## T

**TAL — Time-stamped Annotation List**  
The binary encoding used in EDF+D files to store event annotations. Each entry is formatted as `+<onset_s>\x15<duration_s>\x14<text>\x14\x00`. Used in `CSL` and `EVE` files.

**Tidal volume**  
The volume of air moved in a single breath, in litres. Stored as `tid_vol_l` in `pld_samples` and as `tid_vol_*` percentiles in `daily_summary`. Normal tidal volume at rest is approximately 0.4–0.6 L.

---

## U

**UAI — Unclassified Apnea Index**  
Apneas that the device could not classify as either obstructive or central, per hour.

---
