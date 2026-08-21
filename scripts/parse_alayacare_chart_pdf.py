#!/usr/bin/env python3
"""Convert AlayaCare client-chart batch PDFs into semantic JSON records."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pdfplumber


SCHEMA_KIND = "alayacare-client-chart-data-export"
SCHEMA_VERSION = 2


def clean(value: Any) -> str:
    if value is None:
        return ""
    return re.sub(r"\s+", " ", str(value)).strip()


def clean_multiline(value: Any) -> str:
    if value is None:
        return ""
    return "\n".join(clean(line) for line in str(value).splitlines() if clean(line))


def nullable(value: Any) -> str | None:
    text = clean(value)
    return None if not text or text in {"--", "-"} else text


def split_date_range(value: Any) -> dict[str, str | None]:
    text = clean(value)
    dated_match = re.match(
        r"^(\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?)\s+(?:--|—|–|-)\s*(.*)$",
        text,
    )
    if dated_match:
        return {
            "start": nullable(dated_match.group(1)),
            "end": nullable(dated_match.group(2)),
            "raw": text,
        }
    normalized = text.replace("—", "-").replace("–", "-")
    match = re.match(r"^(.*?)\s+-\s+(.*?)$", normalized)
    if not match:
        return {"start": nullable(normalized), "end": None, "raw": text or None}
    return {
        "start": nullable(match.group(1)),
        "end": nullable(match.group(2)),
        "raw": text or None,
    }


def as_int(value: Any) -> int | None:
    text = clean(value)
    return int(text) if re.fullmatch(r"\d+", text) else None


def combine(existing: str | None, addition: Any) -> str | None:
    added = clean(addition)
    if not added:
        return existing
    if not existing:
        return added
    if added in existing:
        return existing
    return f"{existing}\n{added}"


def header_matches(table: list[list[Any]], labels: Iterable[str]) -> bool:
    if not table:
        return False
    row = [clean(cell).lower() for cell in table[0]]
    return all(any(label.lower() in cell for cell in row) for label in labels)


def page_type(text: str) -> str:
    lowered = text.lower()
    if "cover page" in lowered and "agency information" in lowered:
        return "cover"
    if "medication administration record" in lowered:
        return "medication-administration-record"
    if "medication profile report" in lowered:
        return "medication-profile-report"
    if "service task details" in lowered or "service tasks details" in lowered:
        return "service-task-details"
    if "date overview" in lowered or "summary for:" in lowered:
        return "date-overview"
    if "care plan" in lowered:
        return "care-plan"
    return "unknown"


def parse_header_identity(text: str) -> dict[str, str | None]:
    result: dict[str, str | None] = {
        "name": None,
        "dateOfBirth": None,
        "alayacareId": None,
        "externalId": None,
        "brnNumber": None,
    }
    match = re.search(r"^(.+?)\s*\|\s*DOB:\s*(\d{4}-\d{2}-\d{2})", text, re.MULTILINE)
    if match:
        result["name"] = clean(match.group(1))
        result["dateOfBirth"] = match.group(2)
    for key, label in (
        ("alayacareId", "Alayacare ID"),
        ("externalId", "External ID"),
        ("brnNumber", "BRN number"),
    ):
        found = re.search(rf"{re.escape(label)}:\s*([^\n|]+)", text, re.IGNORECASE)
        if found:
            result[key] = nullable(found.group(1))
    return result


def parse_key_value_rows(rows: list[list[Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for row in rows:
        if len(row) < 2:
            continue
        key = clean(row[0])
        value = clean_multiline(row[1])
        if key and value:
            result[key] = value
    return result


def camel_key(label: str) -> str:
    words = re.findall(r"[A-Za-z0-9]+", label)
    if not words:
        return label
    return words[0].lower() + "".join(word[:1].upper() + word[1:] for word in words[1:])


def semantic_key_values(rows: list[list[Any]]) -> dict[str, Any]:
    return {camel_key(key): value for key, value in parse_key_value_rows(rows).items()}


def parse_cover(tables: list[list[list[Any]]], text: str) -> dict[str, Any]:
    agency: dict[str, Any] = {}
    header_cell = next(
        (
            str(table[0][0])
            for table in tables
            if table and table[0] and any("Cover Page" in clean(cell) for cell in table[0])
        ),
        text,
    )
    client: dict[str, Any] = parse_header_identity(header_cell)
    batch: dict[str, Any] = {}
    emergency_contacts: list[dict[str, str | None]] = []

    for table in tables:
        if not table:
            continue
        first = clean(table[0][0] if table[0] else "").lower()
        if first == "agency name":
            agency.update(semantic_key_values(table))
        elif first == "client name":
            client_key_map = {
                "Client name": "name",
                "Date of birth": "dateOfBirth",
                "Gender": "gender",
                "AlayaCare ID": "alayacareId",
                "External ID": "externalId",
                "BRN number": "brnNumber",
                "Phone number": "phoneNumber",
                "Address": "address",
            }
            for row in table:
                key = clean(row[0] if row else "")
                value = clean_multiline(row[1] if len(row) > 1 else "")
                if key == "Emergency contacts":
                    continue
                if " | " in key and not value:
                    parts = [clean(part) for part in key.split("|")]
                    emergency_contacts.append(
                        {
                            "name": nullable(parts[0] if parts else ""),
                            "relationship": nullable(parts[1] if len(parts) > 1 else ""),
                            "phoneNumber": nullable(parts[2] if len(parts) > 2 else ""),
                        }
                    )
                    continue
                if key and value:
                    client[client_key_map.get(key, camel_key(key))] = value
        elif first == "start/end date":
            batch["dateRange"] = split_date_range(table[0][1] if len(table[0]) > 1 else "")

    if "address" in client:
        client["addressLines"] = str(client["address"]).splitlines()
    if emergency_contacts:
        client["emergencyContacts"] = emergency_contacts
    if "address" in agency:
        agency["addressLines"] = str(agency["address"]).splitlines()
    return {"agency": agency, "client": client, "batch": batch}


def rows_to_objects(table: list[list[Any]], fields: list[str]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for row in table[1:]:
        values = [nullable(cell) for cell in row[: len(fields)]]
        if not any(values):
            continue
        records.append({field: values[index] if index < len(values) else None for index, field in enumerate(fields)})
    return records


def care_plan_title(text: str) -> str | None:
    for line in text.splitlines():
        candidate = clean(line)
        if re.match(r"^Care Plan\s+-\s+", candidate, re.IGNORECASE):
            return candidate
    return None


def new_care_plan(title: str, page_number: int) -> dict[str, Any]:
    return {
        "title": title,
        "sourcePages": [page_number],
        "metadata": {},
        "functionalProfile": {},
        "risks": [],
        "allergies": [],
        "assessments": [],
        "diagnoses": [],
        "interventions": [],
        "signatures": [],
    }


def parse_care_plan_page(plan: dict[str, Any], tables: list[list[list[Any]]]) -> None:
    for table in tables:
        if not table:
            continue
        first_row = [clean(cell) for cell in table[0]]
        first = first_row[0].lower() if first_row else ""

        if header_matches(table, ["Date created", "Created by", "Last updated", "Status"]):
            if len(table) > 1:
                row = [nullable(cell) for cell in table[1]]
                fields = ["dateCreated", "createdBy", "lastUpdated", "updatedBy", "status", "startEndDate", "printedOn"]
                plan["metadata"].update(
                    {field: row[index] if index < len(row) else None for index, field in enumerate(fields)}
                )
                plan["metadata"]["dateRange"] = split_date_range(plan["metadata"].get("startEndDate"))
            continue

        if header_matches(table, ["Risk", "Category", "Severity"]) and len(first_row) == 3:
            plan["risks"].extend(rows_to_objects(table, ["risk", "category", "severity"]))
            continue

        if header_matches(table, ["Name", "Type", "Severity", "Date"]) and len(first_row) == 4:
            plan["allergies"].extend(rows_to_objects(table, ["name", "type", "severity", "date"]))
            continue

        if header_matches(table, ["Date created", "Created by", "Last updated", "Updated by"]) and len(first_row) == 4:
            plan["assessments"].extend(
                rows_to_objects(table, ["dateCreated", "createdBy", "lastUpdated", "updatedBy"])
            )
            continue

        if header_matches(table, ["Functional limitations", "Mental status", "Nutritional requirements"]):
            if len(table) > 1:
                row = table[1]
                plan["functionalProfile"] = {
                    "functionalLimitations": nullable(row[0] if row else ""),
                    "mentalStatus": nullable(row[1] if len(row) > 1 else ""),
                    "nutritionalRequirements": nullable(row[2] if len(row) > 2 else ""),
                }
            continue

        if header_matches(table, ["Diagnosis", "Status", "Start/end date", "Description"]):
            for record in rows_to_objects(table, ["diagnosis", "status", "startEndDate", "description"]):
                record["dateRange"] = split_date_range(record.get("startEndDate"))
                plan["diagnoses"].append(record)
            continue

        is_intervention_header = header_matches(table, ["Intervention", "Status", "Department", "Frequency"])
        is_intervention_continuation = len(first_row) == 7 and first not in {
            "date created",
            "northernhealth",
            "client name",
        }
        if is_intervention_header or is_intervention_continuation:
            rows = table[1:] if is_intervention_header else table
            fields = [
                "intervention",
                "status",
                "department",
                "relatedGoals",
                "frequency",
                "startEndDate",
                "description",
            ]
            for row in rows:
                values = [nullable(cell) for cell in row[:7]]
                if not any(values):
                    continue
                if values[0]:
                    record = {field: values[index] for index, field in enumerate(fields)}
                    record["dateRange"] = split_date_range(record.get("startEndDate"))
                    plan["interventions"].append(record)
                elif plan["interventions"]:
                    record = plan["interventions"][-1]
                    for index, field in enumerate(fields):
                        record[field] = combine(record.get(field), values[index])
                    record["dateRange"] = split_date_range(record.get("startEndDate"))
            continue

        if first == "client signature" and len(first_row) == 2:
            for index in range(0, len(table), 2):
                label_row = table[index]
                value_row = table[index + 1] if index + 1 < len(table) else []
                plan["signatures"].append(
                    {
                        "type": nullable(label_row[0] if label_row else ""),
                        "signedOnLabel": nullable(label_row[1] if len(label_row) > 1 else ""),
                        "signature": nullable(value_row[0] if value_row else ""),
                        "signedOn": nullable(value_row[1] if len(value_row) > 1 else ""),
                    }
                )


def parse_medication_profile(tables: list[list[list[Any]]], page_number: int) -> dict[str, Any]:
    report = {"sourcePage": page_number, "noRecordedMedications": False, "medications": []}
    for table in tables:
        if not table or not header_matches(table, ["Status", "Medication", "Route", "Frequency"]):
            continue
        fields = ["status", "medication", "ingredientStrength", "dosageQuantity", "route", "frequency", "adminType", "startEndDate"]
        current: dict[str, Any] | None = None
        for row in table[1:]:
            values = [nullable(cell) for cell in row[:8]]
            row_text = " ".join(clean(cell) for cell in row if clean(cell))
            if "No recorded medications" in row_text:
                report["noRecordedMedications"] = True
                continue
            if values and values[0] and values[0].lower() in {
                "active",
                "inactive",
                "discontinued",
                "on hold",
            }:
                current = {field: values[index] for index, field in enumerate(fields)}
                current["dateRange"] = split_date_range(current.get("startEndDate"))
                report["medications"].append(current)
                continue
            if current and "administration instructions:" in row_text.lower():
                current["administrationInstructions"] = nullable(
                    re.sub(r"^↳?\s*Administration instructions:\s*", "", row_text, flags=re.IGNORECASE)
                )
            elif current:
                for index, field in enumerate(fields):
                    current[field] = combine(current.get(field), values[index])
    return report


def parse_labeled_block(value: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}
    current_key: str | None = None
    label_map = {
        "start date": "startDate",
        "end date": "endDate",
        "med": "medication",
        "ingredient strength": "ingredientStrength",
        "dosage/quantity": "dosageQuantity",
        "frequency": "frequency",
        "route": "route",
        "drug family": "drugFamily",
        "initials/cosign": "initialsCosign",
        "administration instructions": "administrationInstructions",
        "infusion instructions": "infusionInstructions",
    }
    for raw_line in str(value or "").splitlines():
        line = clean(raw_line)
        if not line:
            continue
        if re.fullmatch(r"\d+/\d+\s+medications", line, re.IGNORECASE):
            continue
        match = re.match(r"^([^:]+):\s*(.*)$", line)
        if match and match.group(1).lower() in label_map:
            current_key = label_map[match.group(1).lower()]
            result[current_key] = nullable(match.group(2))
        elif current_key:
            result[current_key] = combine(result.get(current_key), line)
    return result


def parse_mar_page(tables: list[list[list[Any]]], page_number: int) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for table_index, table in enumerate(tables):
        if not table or not header_matches(table, ["Month", "Client"]):
            continue
        header = table[0]
        record: dict[str, Any] = {
            "sourcePage": page_number,
            "month": nullable(header[1] if len(header) > 1 else ""),
            "clientName": nullable(header[3] if len(header) > 3 else ""),
            "allergies": None,
            "diagnoses": None,
            "medications": [],
        }
        for row in table[1:]:
            label = clean(row[0] if row else "").lower()
            if label == "allergies":
                record["allergies"] = nullable(row[1] if len(row) > 1 else "")
            elif label == "diagnoses":
                record["diagnoses"] = nullable(row[1] if len(row) > 1 else "")

        for candidate in tables[table_index + 1 :]:
            if not candidate or not header_matches(candidate, ["Medication", "Time"]):
                continue
            day_columns = {
                index: int(clean(cell))
                for index, cell in enumerate(candidate[0])
                if re.fullmatch(r"\d{1,2}", clean(cell))
            }
            current_medication: dict[str, Any] | None = None
            for row in candidate[1:]:
                if clean(row[0] if row else "").lower() == "medication":
                    continue
                details = parse_labeled_block(row[0] if row else "")
                instruction_text = "\n".join(clean_multiline(cell) for cell in row[1:3] if clean_multiline(cell))
                details.update({key: value for key, value in parse_labeled_block(instruction_text).items() if value})
                day_values = {
                    str(day): nullable(row[index] if index < len(row) else "")
                    for index, day in day_columns.items()
                    if nullable(row[index] if index < len(row) else "")
                }
                if details and set(details) <= {"administrationInstructions", "infusionInstructions"} and current_medication:
                    current_medication.update({key: value for key, value in details.items() if value})
                elif details:
                    details["administrationsByDay"] = day_values
                    record["medications"].append(details)
                    current_medication = details
                elif day_values and current_medication:
                    current_medication["administrationsByDay"].update(day_values)
            break
        records.append(record)
    return records


def parse_visit_period(value: Any) -> dict[str, str | None]:
    text = clean(value).replace("—", "-").replace("–", "-")
    timestamps = re.findall(r"\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s*\([A-Z]+\)", text)
    return {
        "scheduledStart": timestamps[0] if timestamps else None,
        "scheduledEnd": timestamps[1] if len(timestamps) > 1 else None,
        "raw": text or None,
    }


def metric_value(value: Any) -> dict[str, int | str | None]:
    text = clean(value)
    match = re.fullmatch(r"(\d+)\s*/\s*(\d+)", text)
    return {
        "completed": int(match.group(1)) if match else None,
        "total": int(match.group(2)) if match else None,
        "raw": text or None,
    }


def extract_metric_from_row(row: list[Any], label_index: int) -> str | None:
    values = [clean(cell) for cell in row[label_index + 1 :] if clean(cell)]
    return values[-1] if values else None


def parse_visit_table(table: list[list[Any]], date: str, page_number: int) -> list[dict[str, Any]]:
    visits: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    for row in table[1:]:
        visit_id = clean(row[0] if row else "")
        if re.fullmatch(r"\d+", visit_id):
            period = parse_visit_period(row[1] if len(row) > 1 else "")
            current = {
                "visitId": visit_id,
                "date": date,
                **period,
                "employee": nullable(row[2] if len(row) > 2 else ""),
                "serviceNameCode": nullable(row[3] if len(row) > 3 else ""),
                "interventions": metric_value(None),
                "goals": metric_value(None),
                "serviceTaskFormsTotal": None,
                "attachmentsTotal": None,
                "forms": [],
                "sourcePages": [page_number],
            }
            visits.append(current)
        if not current:
            continue
        for index, cell in enumerate(row):
            label = clean(cell).lower()
            if "interventions" in label and "completed/total" in label:
                current["interventions"] = metric_value(extract_metric_from_row(row, index))
            elif "goals" in label and "completed/total" in label:
                current["goals"] = metric_value(extract_metric_from_row(row, index))
            elif "service task forms" in label and "total" in label:
                current["serviceTaskFormsTotal"] = as_int(extract_metric_from_row(row, index))
            elif "attachments" in label and "total" in label:
                current["attachmentsTotal"] = as_int(extract_metric_from_row(row, index))
    return visits


def merge_visit(target: dict[str, Any], source: dict[str, Any]) -> None:
    for field in (
        "scheduledStart",
        "scheduledEnd",
        "raw",
        "employee",
        "serviceNameCode",
        "serviceTaskFormsTotal",
        "attachmentsTotal",
    ):
        if source.get(field) is not None:
            target[field] = source[field]
    for field in ("interventions", "goals"):
        if source.get(field, {}).get("raw") is not None:
            target[field] = source[field]
    target["sourcePages"] = sorted(set(target.get("sourcePages", []) + source.get("sourcePages", [])))
    if source.get("forms"):
        target["forms"] = source["forms"]


def extract_enriched_tables(page: Any, detected_type: str) -> list[list[list[Any]]]:
    """Extract tables and repair care-plan description cells split by partial borders."""
    extracted_tables: list[list[list[Any]]] = []
    for found_table in page.find_tables():
        extracted = found_table.extract()
        if detected_type == "care-plan" and extracted and len(extracted[0]) == 7:
            description_x0 = next(
                (
                    cell[0]
                    for row in found_table.rows
                    for cell in [row.cells[6] if len(row.cells) > 6 else None]
                    if cell is not None
                ),
                None,
            )
            if description_x0 is not None:
                for row_index, found_row in enumerate(found_table.rows):
                    cells = [cell for cell in found_row.cells if cell is not None]
                    if not cells or row_index >= len(extracted):
                        continue
                    row_top = min(cell[1] for cell in cells)
                    row_bottom = max(cell[3] for cell in cells)
                    if row_bottom <= row_top:
                        continue
                    description = page.crop(
                        (description_x0, row_top, found_table.bbox[2], row_bottom)
                    ).extract_text(x_tolerance=2, y_tolerance=2)
                    if clean(description):
                        extracted[row_index][6] = clean_multiline(description)
        extracted_tables.append(extracted)
    return extracted_tables


def parse_chart(pdf_path: Path) -> dict[str, Any]:
    raw_pages: list[dict[str, Any]] = []
    with pdfplumber.open(pdf_path) as pdf:
        for page_number, page in enumerate(pdf.pages, 1):
            text = page.extract_text(x_tolerance=2, y_tolerance=2) or ""
            detected_type = page_type(text)
            tables = extract_enriched_tables(page, detected_type)
            raw_pages.append(
                {
                    "pageNumber": page_number,
                    "reportType": detected_type,
                    "text": text,
                    "tables": tables,
                }
            )

    cover_page = next((page for page in raw_pages if page["reportType"] == "cover"), None)
    cover = parse_cover(cover_page["tables"], cover_page["text"]) if cover_page else {
        "agency": {},
        "client": parse_header_identity(raw_pages[0]["text"] if raw_pages else ""),
        "batch": {},
    }

    care_plans: list[dict[str, Any]] = []
    current_plan: dict[str, Any] | None = None
    for page in raw_pages:
        if page["reportType"] != "care-plan":
            continue
        title = care_plan_title(page["text"])
        if title:
            current_plan = new_care_plan(title, page["pageNumber"])
            care_plans.append(current_plan)
        elif current_plan:
            current_plan["sourcePages"].append(page["pageNumber"])
        else:
            current_plan = new_care_plan("Care Plan", page["pageNumber"])
            care_plans.append(current_plan)
        parse_care_plan_page(current_plan, page["tables"])

    medication_profiles = [
        parse_medication_profile(page["tables"], page["pageNumber"])
        for page in raw_pages
        if page["reportType"] == "medication-profile-report"
    ]
    medication_administration_records = [
        record
        for page in raw_pages
        if page["reportType"] == "medication-administration-record"
        for record in parse_mar_page(page["tables"], page["pageNumber"])
    ]

    visits_by_key: dict[tuple[str, str], dict[str, Any]] = {}
    for page in raw_pages:
        if page["reportType"] not in {"date-overview", "service-task-details"}:
            continue
        summary_match = re.search(r"Summary for:\s*(\d{4}-\d{2}-\d{2})", page["text"])
        page_date = summary_match.group(1) if summary_match else None
        if not page_date and page["tables"] and page["tables"][0] and page["tables"][0][0]:
            middle_cell = page["tables"][0][0][1] if len(page["tables"][0][0]) > 1 else ""
            header_match = re.search(r"\d{4}-\d{2}-\d{2}", clean(middle_cell))
            page_date = header_match.group(0) if header_match else None
        if not page_date:
            continue
        date = page_date
        last_page_visit: dict[str, Any] | None = None
        for table in page["tables"]:
            if header_matches(table, ["Visit ID", "Employee", "Service name/code"]):
                for visit in parse_visit_table(table, date, page["pageNumber"]):
                    key = (date, visit["visitId"])
                    if key in visits_by_key:
                        merge_visit(visits_by_key[key], visit)
                    else:
                        visits_by_key[key] = visit
                    last_page_visit = visits_by_key[key]
            elif header_matches(table, ["Form Name", "Required", "Completed"]):
                forms = rows_to_objects(
                    table,
                    ["formName", "required", "completed", "employee", "comments"],
                )
                if last_page_visit:
                    last_page_visit["forms"].extend(forms)

    visits = sorted(
        visits_by_key.values(),
        key=lambda visit: (visit.get("scheduledStart") or visit["date"], int(visit["visitId"])),
    )
    visit_days: list[dict[str, Any]] = []
    for date in sorted({visit["date"] for visit in visits}):
        day_visits = [visit for visit in visits if visit["date"] == date]
        visit_days.append({"date": date, "visits": day_visits})

    source_bytes = pdf_path.read_bytes()
    source_stat = pdf_path.stat()
    return {
        "kind": SCHEMA_KIND,
        "schemaVersion": SCHEMA_VERSION,
        "convertedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "sourceFile": {
            "name": pdf_path.name,
            "size": source_stat.st_size,
            "modifiedAt": datetime.fromtimestamp(source_stat.st_mtime, timezone.utc).isoformat().replace("+00:00", "Z"),
            "sha256": hashlib.sha256(source_bytes).hexdigest(),
            "pageCount": len(raw_pages),
        },
        "scope": {
            "syntheticUatConfirmed": True,
            "localOnly": True,
            "semanticTablesParsed": True,
            "sourceTablesIncluded": True,
        },
        "agency": cover["agency"],
        "client": cover["client"],
        "batch": cover["batch"],
        "carePlans": care_plans,
        "medicationProfiles": medication_profiles,
        "medicationAdministrationRecords": medication_administration_records,
        "visitDays": visit_days,
        "counts": {
            "carePlans": len(care_plans),
            "risks": sum(len(plan["risks"]) for plan in care_plans),
            "allergies": sum(len(plan["allergies"]) for plan in care_plans),
            "diagnoses": sum(len(plan["diagnoses"]) for plan in care_plans),
            "interventions": sum(len(plan["interventions"]) for plan in care_plans),
            "medications": sum(len(report["medications"]) for report in medication_profiles),
            "marMonths": len(medication_administration_records),
            "visitDays": len(visit_days),
            "visits": len(visits),
            "visitForms": sum(len(visit["forms"]) for visit in visits),
            "sourcePages": len(raw_pages),
        },
        "sourcePages": raw_pages,
    }


def output_name(pdf_path: Path) -> str:
    return f"{pdf_path.stem}.alayacare-chart-data.json"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdfs", nargs="+", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for pdf_path in args.pdfs:
        chart = parse_chart(pdf_path)
        destination = args.output_dir / output_name(pdf_path)
        destination.write_text(json.dumps(chart, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(
            f"{pdf_path.name} -> {destination.name}: "
            f"{chart['counts']['visits']} visits, "
            f"{chart['counts']['interventions']} interventions"
        )


if __name__ == "__main__":
    main()
