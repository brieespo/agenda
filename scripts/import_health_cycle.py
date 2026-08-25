#!/usr/bin/env python3
"""
One-time backfill: Apple Health export -> SQL you paste into Supabase.

    Health app -> your profile picture -> Export All Health Data
    -> export.zip (AirDrop it to the Mac)

    python3 scripts/import_health_cycle.py export.zip --email you@example.com

Then: Supabase dashboard -> SQL Editor -> paste -> Run. The statement resolves
your user_id from auth.users by email, so the uuid never has to be looked up.
`--format csv` still writes a CSV for Table Editor -> Import, but that one needs
`--user-id` because the uuid goes in every row.

Deliberately offline. It never touches the network and never needs a Supabase
key or a database password — either of those on a command line, to load a few
hundred rows once, is the worse trade.

Reads the zip a chunk at a time (export.xml runs to hundreds of MB after a few
years) and writes one row per day per kind, which is the grain the table
enforces. Pregnancy and lactation come out separately as intervals, and exist
only to name a long gap between periods; nothing about them affects period
detection.
"""

import argparse
import csv
import io
import re
import sys
import zipfile
from collections import defaultdict
from xml.etree import ElementTree

# Health has renamed these types across iOS versions and an old export keeps the
# old spelling, so both generations are mapped rather than assuming the current
# one. MenstrualFlow is the period itself; IntermenstrualBleeding is what the
# Health UI calls spotting.
FLOW_TYPES = {
    "HKCategoryTypeIdentifierMenstrualFlow",
}
SPOTTING_TYPES = {
    "HKCategoryTypeIdentifierIntermenstrualBleeding",
}
SEX_TYPES = {
    "HKCategoryTypeIdentifierSexualActivity",
}
# Intervals, not day marks — Health stores each as one record with a startDate
# and an endDate months or years apart. They exist only to name a gap in the
# history ("pregnancy" rather than "356-day gap") and take no part in period
# detection.
SPAN_TYPES = {
    "HKCategoryTypeIdentifierPregnancy": "pregnancy",
    "HKCategoryTypeIdentifierLactation": "lactation",
}

# Values arrive as HKCategoryValueMenstrualFlowLight, and on newer exports as
# HKCategoryValueVaginalBleedingLight. Match on the tail rather than the prefix.
FLOW_VALUES = {
    "light": "light",
    "medium": "medium",
    "heavy": "heavy",
    # "Unspecified" means she logged a period day without saying how much. It is
    # a real bleeding day, so dropping it would shorten periods in the history;
    # it lands in the middle bucket and is counted in the summary so the guess
    # is visible rather than silent.
    "unspecified": "medium",
    # "None" is an explicit not-bleeding mark. It is an absence, and this table
    # stores only what happened.
    "none": None,
}

FLOW_RANK = {"spotting": 0, "light": 1, "medium": 2, "heavy": 3}
SEX_RANK = {"protected": 0, "unprotected": 1}


def local_date(stamp):
    """'2026-08-03 07:12:00 -0500' -> '2026-08-03'.

    The date is taken as written. These stamps already carry the offset that was
    in force where she was standing, so converting to UTC would move a late-night
    entry onto the next day — the one thing a day-grained log must not do.
    """
    return stamp.split(" ", 1)[0] if stamp else None


def flow_value(raw):
    if not raw:
        return None
    tail = raw.rsplit("HKCategoryValue", 1)[-1].lower()
    for key, mapped in FLOW_VALUES.items():
        if tail.endswith(key):
            return mapped
    return None


def parse(xml_stream, stats, spans):
    """Yield (date, kind, value) day marks; collect interval records into `spans`."""
    # A Record's protection metadata is a child element, so each Record has to
    # be complete before it can be read — hence 'end' events, clearing as we go.
    context = ElementTree.iterparse(xml_stream, events=("end",))
    for _event, elem in context:
        if elem.tag != "Record":
            continue
        rtype = elem.get("type")
        date = local_date(elem.get("startDate"))

        if date and rtype in SPAN_TYPES:
            end = local_date(elem.get("endDate"))
            # Health writes an open span with endDate == startDate; treat a
            # zero-length one as still going rather than as a same-day event.
            spans.add((SPAN_TYPES[rtype], date, end if end and end != date else None))

        elif date and rtype in FLOW_TYPES:
            value = flow_value(elem.get("value"))
            if value:
                if elem.get("value", "").lower().endswith("unspecified"):
                    stats["flow_unspecified"] += 1
                yield date, "flow", value
            else:
                stats["flow_none"] += 1

        elif date and rtype in SPOTTING_TYPES:
            # A spotting record carries value "NotApplicable"; its presence is
            # the fact.
            yield date, "flow", "spotting"

        elif date and rtype in SEX_TYPES:
            # Unprotected is the default, not a separate "unknown" state:
            # protection is the exception worth recording, so a sample that
            # never claims it is treated as not having had it.
            value = "unprotected"
            found = False
            for md in elem.findall("MetadataEntry"):
                if md.get("key") == "HKSexualActivityProtectionUsed":
                    value = "protected" if md.get("value") == "1" else "unprotected"
                    found = True
            if not found:
                stats["sex_no_metadata"] += 1
            yield date, "sex", value

        elem.clear()


def collapse(rows):
    """One row per (date, kind).

    Health can hold several samples for one day — two flow entries edited hours
    apart, or more than one sexual-activity sample. The table stores a day's
    answer, so the strongest value on a day wins: a heavy entry is not erased by
    a light one logged later, and a day with any unprotected entry stays
    unprotected.
    """
    # Both ranks are total orders over their kind's values, so every pair is
    # comparable and the winner never depends on the order records appear in.
    best = {}
    for date, kind, value in rows:
        key = (date, kind)
        rank = FLOW_RANK if kind == "flow" else SEX_RANK
        if key not in best or rank[value] > rank[best[key]]:
            best[key] = value
    return best


def write_sql(path, rows, spans, email, user_id):
    """One statement to paste into the Supabase SQL editor.

    Written against auth.users by email so the uuid never has to be looked up by
    hand and never has to be pasted into a chat. ON CONFLICT makes the whole
    thing re-runnable: a second paste, or a re-import after logging a few days
    in the app, updates instead of erroring.

    Values are not interpolated blind — dates are checked against a literal
    pattern and kind/value against the same closed vocabularies the table's
    CHECK constraint uses, so nothing reaches the file that the column would
    reject. The email is the one free-form value and is quote-escaped.
    """
    for date, kind in (k for k, _v in rows):
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            sys.exit(f"refusing to write a malformed date: {date!r}")
        if kind not in ("flow", "sex"):
            sys.exit(f"refusing to write an unknown kind: {kind!r}")
    for (_d, kind), value in rows:
        allowed = FLOW_RANK if kind == "flow" else SEX_RANK
        if value not in allowed:
            sys.exit(f"refusing to write an unknown value: {value!r}")
    for kind, start, end in spans:
        if kind not in SPAN_TYPES.values():
            sys.exit(f"refusing to write an unknown span kind: {kind!r}")
        for date in (start, end):
            if date is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
                sys.exit(f"refusing to write a malformed span date: {date!r}")

    tuples = ",\n    ".join(f"('{d}', '{k}', '{v}')" for (d, k), v in rows)

    if email:
        owner = f"  cross join auth.users u\n where u.email = '{email.replace(chr(39), chr(39) * 2)}'\n"
        user_expr = "u.id"
    else:
        owner = ""
        user_expr = f"'{user_id}'::uuid"

    with open(path, "w") as f:
        f.write(
            "-- Apple Health backfill for cycle_events. Safe to run more than once:\n"
            "-- ON CONFLICT updates, so a re-import after logging a few days in the\n"
            "-- app corrects those days rather than failing.\n"
            "insert into public.cycle_events (user_id, date, kind, value)\n"
            f"select {user_expr}, v.date::date, v.kind, v.value\n"
            "  from (values\n"
            f"    {tuples}\n"
            "  ) as v(date, kind, value)\n"
            f"{owner}"
            "on conflict (user_id, date, kind) do update set value = excluded.value;\n"
        )
        if spans:
            span_tuples = ",\n    ".join(
                "('%s', '%s', %s)" % (k, s, f"'{e}'" if e else "null")
                for k, s, e in sorted(spans)
            )
            f.write(
                "\n-- Named spans, so a long stretch between periods reads as what it was\n"
                "-- rather than as a bare day count. These never affect period detection.\n"
                "insert into public.cycle_spans (user_id, kind, start_date, end_date)\n"
                f"select {user_expr}, v.kind, v.start_date::date, v.end_date::date\n"
                "  from (values\n"
                f"    {span_tuples}\n"
                "  ) as v(kind, start_date, end_date)\n"
                f"{owner}"
                "on conflict (user_id, kind, start_date)\n"
                "  do update set end_date = excluded.end_date;\n"
            )
        f.write(
            "\n"
            "-- The editor shows the last statement's result. A wrong email matches no\n"
            "-- user and inserts nothing without erroring, so this is how you tell:\n"
            "select count(*) filter (where kind = 'flow') as bleeding_days,\n"
            "       count(*) filter (where kind = 'sex')  as other_days,\n"
            "       (select count(*) from public.cycle_spans) as named_spans\n"
            "  from public.cycle_events;\n"
        )


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("export", help="export.zip from Apple Health (or an unzipped export.xml)")
    who = ap.add_mutually_exclusive_group(required=True)
    who.add_argument("--email", help="the email you sign into the app with; --format sql "
                                     "looks the uuid up from it, so you never have to find it")
    who.add_argument("--user-id", help="your Supabase auth uuid (Authentication -> Users)")
    ap.add_argument("--format", choices=("sql", "csv"), default="sql",
                    help="sql: one statement to paste into the SQL editor (default). "
                         "csv: a file for Table Editor -> Import data from CSV")
    ap.add_argument("-o", "--out", help="file to write (default cycle_events.sql/.csv)")
    args = ap.parse_args()

    if args.user_id and not re.fullmatch(r"[0-9a-fA-F-]{36}", args.user_id):
        sys.exit(f"--user-id does not look like a uuid: {args.user_id}")
    if args.format == "csv" and not args.user_id:
        sys.exit("--format csv writes the uuid into every row, so it needs --user-id.\n"
                 "Use --format sql with --email to skip looking the uuid up.")
    out = args.out or f"cycle_events.{args.format}"

    stats = defaultdict(int)
    spans = set()

    if args.export.endswith(".zip"):
        with zipfile.ZipFile(args.export) as z:
            names = [n for n in z.namelist() if n.endswith("export.xml")]
            if not names:
                sys.exit("No export.xml inside that zip.")
            # apple_health_export/export.xml is the usual path; take the
            # shallowest match so a nested duplicate can't win.
            name = min(names, key=lambda n: n.count("/"))
            with z.open(name) as f:
                best = collapse(parse(f, stats, spans))
    else:
        with open(args.export, "rb") as f:
            best = collapse(parse(f, stats, spans))

    rows = sorted(best.items())
    if args.format == "csv":
        with open(out, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["user_id", "date", "kind", "value"])
            for (date, kind), value in rows:
                w.writerow([args.user_id, date, kind, value])
    else:
        write_sql(out, rows, spans, args.email, args.user_id)

    flow_days = sum(1 for (_d, k) in best if k == "flow")
    sex_days = sum(1 for (_d, k) in best if k == "sex")
    dates = sorted({d for (d, _k) in best})

    print(f"Wrote {len(best)} rows to {out}")
    print(f"  {flow_days} bleeding days, {sex_days} other days")
    if dates:
        print(f"  spanning {dates[0]} to {dates[-1]}")
    if stats["flow_unspecified"]:
        print(f"  {stats['flow_unspecified']} flow samples had no amount -> stored as medium")
    if stats["sex_no_metadata"]:
        print(f"  {stats['sex_no_metadata']} samples had no protection metadata -> stored as unprotected")
    if stats["flow_none"]:
        print(f"  {stats['flow_none']} explicit 'no flow' marks skipped")
    for kind, start, end in sorted(spans):
        print(f"  {kind}: {start} -> {end or 'ongoing'}")
    if args.format == "sql":
        print(f"\nNext: open {out}, copy all of it, paste into Supabase -> SQL Editor -> Run.")
    else:
        print("\nNext: Supabase -> Table Editor -> cycle_events -> Insert -> Import data from CSV")


if __name__ == "__main__":
    main()
