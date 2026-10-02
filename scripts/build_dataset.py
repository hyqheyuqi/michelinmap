#!/usr/bin/env python3
"""Build the map-ready Michelin award dataset from the upstream CSV snapshot."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path


AWARDS = {
    "Bib Gourmand": ("bib-gourmand", 0),
    "1 Star": ("1-star", 1),
    "2 Stars": ("2-stars", 2),
    "3 Stars": ("3-stars", 3),
}

SINGLE_PART_LOCATIONS = {
    "Abu Dhabi": ("Abu Dhabi", "", "United Arab Emirates"),
    "Dubai": ("Dubai", "", "United Arab Emirates"),
    "Luxembourg": ("Luxembourg", "", "Luxembourg"),
    "Macau": ("Macau", "", "Macau SAR China"),
    "Singapore": ("Singapore", "", "Singapore"),
}

REQUIRED_FIELDS = {
    "id",
    "name",
    "country",
    "city",
    "location_raw",
    "address",
    "cuisine",
    "award",
    "price_symbols",
    "longitude",
    "latitude",
    "source_url",
    "snapshot_date",
}


def split_location(value: str) -> tuple[str, str, str]:
    parts = [part.strip() for part in value.split(",") if part.strip()]
    if len(parts) == 1 and parts[0] in SINGLE_PART_LOCATIONS:
        return SINGLE_PART_LOCATIONS[parts[0]]
    city = parts[0] if parts else ""
    country = parts[-1] if len(parts) > 1 else ""
    region = ", ".join(parts[1:-1])
    return city, region, country


def build(source: Path, output_dir: Path, snapshot_date: str) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    restaurants = []

    with source.open(encoding="utf-8", newline="") as handle:
        for source_row in csv.DictReader(handle):
            if source_row["Award"] not in AWARDS:
                continue

            award, stars = AWARDS[source_row["Award"]]
            city, region, country = split_location(source_row["Location"])
            source_url = source_row["Url"].strip()
            restaurants.append(
                {
                    "id": "michelin-" + hashlib.sha256(source_url.encode()).hexdigest()[:16],
                    "name": source_row["Name"].strip(),
                    "country": country,
                    "region": region,
                    "city": city,
                    "location_raw": source_row["Location"].strip(),
                    "address": source_row["Address"].strip(),
                    "cuisine": source_row["Cuisine"].strip(),
                    "award": award,
                    "stars": stars,
                    "price_symbols": source_row["Price"].strip(),
                    "longitude": float(source_row["Longitude"]),
                    "latitude": float(source_row["Latitude"]),
                    "source_url": source_url,
                    "snapshot_date": snapshot_date,
                }
            )

    restaurants.sort(key=lambda row: (row["country"], row["city"], row["name"]))
    fields = list(restaurants[0])

    csv_path = output_dir / "restaurants.csv"
    with csv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(restaurants)

    summary_rows = []
    for country in sorted({row["country"] for row in restaurants}):
        country_rows = [row for row in restaurants if row["country"] == country]
        counts = Counter(row["award"] for row in country_rows)
        summary_rows.append(
            {
                "country": country,
                "total": len(country_rows),
                "bib_gourmand": counts["bib-gourmand"],
                "one_star": counts["1-star"],
                "two_stars": counts["2-stars"],
                "three_stars": counts["3-stars"],
            }
        )
    with (output_dir / "country-summary.csv").open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(summary_rows[0]))
        writer.writeheader()
        writer.writerows(summary_rows)

    features = []
    for row in restaurants:
        properties = {key: value for key, value in row.items() if key not in {"longitude", "latitude"}}
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [row["longitude"], row["latitude"]],
                },
                "properties": properties,
            }
        )
    geojson_path = output_dir / "restaurants.geojson"
    geojson_path.write_text(
        json.dumps({"type": "FeatureCollection", "features": features}, ensure_ascii=False),
        encoding="utf-8",
    )

    city_groups = defaultdict(list)
    for row in restaurants:
        city_groups[(row["country"], row["region"], row["city"])].append(row)

    city_features = []
    city_restaurants = {}
    for (country, region, city), rows in sorted(city_groups.items()):
        city_key = hashlib.sha256(f"{country}|{region}|{city}".encode()).hexdigest()[:16]
        counts = Counter(row["award"] for row in rows)
        longitude = sum(row["longitude"] for row in rows) / len(rows)
        latitude = sum(row["latitude"] for row in rows) / len(rows)
        city_features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [longitude, latitude]},
                "properties": {
                    "city_key": city_key,
                    "city": city,
                    "region": region,
                    "country": country,
                    "total": len(rows),
                    "bib_gourmand": counts["bib-gourmand"],
                    "one_star": counts["1-star"],
                    "two_stars": counts["2-stars"],
                    "three_stars": counts["3-stars"],
                },
            }
        )
        city_restaurants[city_key] = [
            {
                key: row[key]
                for key in (
                    "id",
                    "name",
                    "address",
                    "cuisine",
                    "award",
                    "stars",
                    "price_symbols",
                    "longitude",
                    "latitude",
                    "source_url",
                )
            }
            for row in rows
        ]

    (output_dir / "cities.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": city_features}, ensure_ascii=False),
        encoding="utf-8",
    )
    (output_dir / "city-restaurants.json").write_text(
        json.dumps(city_restaurants, ensure_ascii=False), encoding="utf-8"
    )

    report = {
        "snapshot_date": snapshot_date,
        "restaurant_count": len(restaurants),
        "award_counts": dict(sorted(Counter(row["award"] for row in restaurants).items())),
        "country_count": len({row["country"] for row in restaurants}),
        "city_count": len({(row["country"], row["city"]) for row in restaurants}),
        "missing_counts": {
            field: sum(not str(row[field]).strip() for row in restaurants)
            for field in fields
            if field in REQUIRED_FIELDS
        },
    }
    (output_dir / "quality-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output-dir", type=Path, default=Path("data"))
    parser.add_argument("--snapshot-date", default=date.today().isoformat())
    args = parser.parse_args()
    build(args.source, args.output_dir, args.snapshot_date)


if __name__ == "__main__":
    main()
