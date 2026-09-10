# Notice — data sources, attribution, and what the license covers

CleanPlateVA is an independent presentation of publicly available food
establishment inspection records. It is not affiliated with, operated by, or
endorsed by any health department.

The canonical statement of terms is the **Terms of Use and Data
Acknowledgment** shown in the application itself (About §06, and the
acknowledgement dialog). This file is the repository-level summary of the same
substance, provided so that anyone reading the source can see the position
without running the site. Where the two differ, the in-application terms
govern.

## What the MIT license covers

[LICENSE](LICENSE) covers the **source code** in this repository.

It does **not** cover the inspection data committed under `public/data/`. That
data is derived from records published by the agencies named below, is not the
copyright holder's to relicense, and remains subject to the terms of the
publishing department. Anyone redistributing it is responsible for satisfying
those terms directly.

## Inspection records

Records originate from two agencies:

- the **Virginia Department of Health**, through
  [MyHealthDepartment](https://inspections.myhealthdepartment.com/virginia),
  for localities served by VDH health districts;
- the **Fairfax County Health Department**, through its
  [Food Establishment Inspection Reports](https://www.fairfaxcounty.gov/health/food/inspection-reports)
  system, for the Fairfax localities it serves.

What this site publishes is an **archived snapshot**, not a live feed. The
original record published by the responsible department remains the
authoritative source, and should be consulted whenever current or official
information is required. Every marker in the application links to its
establishment's record at the publishing department.

## Scores and grades are derived, not official

Neither agency issues letter grades on inspection reports.

Scores, letter grades, compliance percentages, trends, flags and other
summaries in this repository and in the application are **calculated by
CleanPlateVA** from the underlying inspection records. They are not issued or
approved by either department and must not be read as official restaurant
grades, food-safety certifications, health-risk assessments, or predictions
about whether a person will become ill. They are provided as is, without
warranty as to accuracy, completeness, or fitness for any particular purpose.

Fairfax County records its own inspection outcome — such as Passed or Partial
Pass — with each report. Where that outcome is displayed it is the county's
determination: it is neither derived from nor used to derive this project's
score or grade, and the two may differ.

## Location data

Coordinates are compiled from public and open geographic data sources,
including the Virginia Geographic Information Network (VGIN) at the Virginia
Department of Emergency Management, the U.S. Census Bureau Geocoder and
Gazetteer, OpenStreetMap and its Nominatim and Overpass services, Overture
Maps, Foursquare's open place data, and Fairfax County GIS establishment
locations published alongside the county's inspection records. Some locations
are approximate, and some are placed or corrected manually from available
source information.

Each of those sources carries its own attribution and licence terms, which
apply to the coordinates derived from it.

## Basemaps

Map tiles are served by CARTO over OpenStreetMap data, and aerial imagery by
the Virginia Base Mapping Program (VBMP) through VGIN. Both are attributed in
the application's map chrome.
