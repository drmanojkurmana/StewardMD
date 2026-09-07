# Gov scheme package/rate sources, batch 2 (verified in real Chrome, 2026-09-02)

Method: every URL below was loaded in a Chrome tab (chrome-devtools MCP). PDFs/XLSX were
additionally pulled with curl and inspected with pdftotext/openpyxl to read column headers and
count rows. "Rows" = approximate count of procedure-code lines found in the extracted text.

## Rajasthan (RGHS)
- Status: VERIFIED-FILE (PDF)
- Package master with rates:
  `https://rghs.rajasthan.gov.in/RGHS_PACKAGE_CODE_MASTER_07_01_2025.pdf`
  Found via Circulars & Notices datatable (`https://rghs.rajasthan.gov.in/RGHS/home/circularNotice`,
  row 48, "RGHS Package Codes Master as on 07.01.2025"; same file also linked from row 161
  "Package rate for jaipur RGHS" via
  `https://rghs.rajasthan.gov.in/RGHS/downloadHomeDocument?filename=/appdata24/RghsHome/2025/2025-03-10/RGHS_PACKAGE_CODE_MASTER_07_01_2025.pdf`).
  Columns: `Package Code | Package Name | NABH Rate | Non-NABH Rate`. 70 pages, ~1620 rows
  (codes 1 .. 1882, suffixed variants like 1877C). Sample: 32 Pterygium Surgery 6325 / 5500.
- Codes without rates (department/IPD/daycare/OPD flags only):
  `https://rghs.rajasthan.gov.in/departmentwisepackagecode.pdf` (Hospitals & Pharmacies menu,
  "Department Wise Package Codes"). Columns: `PACKAGECODE | PACKAGENAME | IPD | DAYCARE | OPD`,
  50 pages, ~1900 rows. RGHS states rates follow CGHS package rates.
- Related (not inspected): Ayurveda Package Code Master 29.09.2025
  `https://rghs.rajasthan.gov.in/RGHS/downloadHomeDocument?filename=/appdata25/RghsHome/2025/2025-10-08/AyurvedaPackageCodes.pdf`,
  Medical Management Packages `https://rghs.rajasthan.gov.in/medicalmanagementpackagesupdated20July2023.pdf`.
- health.rajasthan.gov.in not explored (RGHS file already found). chiranjeevi skipped per brief.

## Uttar Pradesh (SACHIS / AB-PMJAY)
- Status: VERIFIED-FILE (PDF)
- ayushmanup.in redirects to sachis.in. Downloads menu -> "HBP Package 2022":
  `https://www.sachis.in/assets/HBP-2022.pdf`
  Title "Package Master - HBP-2022". Columns: `Specialty | Specialty Code HBP 2022 | Package Code
  HBP 2022 | AB PMJAY Package Name | Procedure code HBP 2022 | Procedure Name 2022 | Tier3 (Z) |
  Tier2 (Y) | Tier1 (X) | Implant mapped | implant cost | Stratification remarks`.
  188 pages, ~1990 procedure rows (e.g. BM001A 7000 / 8200 / 8800).
- Site banner says "website is under development".

## Uttarakhand (SHA Uttarakhand)
- Status: VERIFIED-TABLE (HTML, per-speciality modal) + VERIFIED-FILE
- Packages page: `https://sha.uk.gov.in/CMS/GetDiseaseCovered` lists 24 specialities with a
  "Show" button each; clicking opens a modal DataTable "List Of Package and Rates" with columns
  `Sl.No | Package Code | Package Name | Procedure Code | Procedure Name | Amount`
  (sample: MC001 Right / Left Heart Catheterization, MC001A Right Heart Catheterization, 5000).
  Data comes from `POST https://sha.uk.gov.in/CMS/GetSpecDetails` body `SPEC_CODE=<code>`
  (JSON keys PKG_CODE, PKG_NAME, PROC_CODE, PROC_NAME, PROC_AMT, SPEC_NAME). Total 1622 rows
  across codes BM MC SV ER MG SG IN MO MM MN SN SO SE SM SB SL MP SS SP ST MR SC SU US
  (e.g. MO 272, SG 155, SU 143, SB 135, SC 120, SV 118). Paginated 10/25/50/100 in the modal.
- Files page `https://sha.uk.gov.in/CMS/ReadFiles?FOLDER_NAME=HBP` (Health benefit packages):
  `https://sha.uk.gov.in//ScannedDocs/WebSite/Uploads/HBP/HBP%202022%20..pdf` (HBP 2022),
  `https://sha.uk.gov.in//ScannedDocs/WebSite/Uploads/HBP/Rate%20Revision409_Procedure.pdf`,
  `https://sha.uk.gov.in//ScannedDocs/WebSite/Uploads/HBP/CGHS%20Rates%202014-%20Dehradun.pdf`,
  HBP 2.1 / 2.0 / 1.0 PDFs also listed. Links seen, PDFs not opened.
- ayushmanuttarakhand.org not visited (time-box; sha.uk.gov.in sufficed).

## Punjab (SHA Punjab, AB-MMSBY)
- Status: VERIFIED-FILE (PDF)
- Packages page `https://sha.punjab.gov.in/shapunjab/packages.php` (Hospitals -> Packages):
  HTML table `Title | Download` with 6 rows. Main file:
  `https://sha.punjab.gov.in/shapunjab/documents/HBP2.2.pdf` ("Health Benefit Package (HBP 2.2)").
  Columns: `Specialty Code HBP 2.0 | Specialty | Package Code HBP 2.1 | AB PM-JAY Package Name |
  Procedure Code | AB PM-JAY Procedure Name | Procedure Price | Stratification | Implant | Total
  Package Price`. 55 pages, 1670 unique procedure codes (BM001A 7,000; BM001B 40,000).
  Other files on the same page: High-end procedures
  `https://sha.punjab.gov.in/shapunjab/documents/Highendprocedurestobeaddedfrom2022.pdf`,
  reserve packages `.../documents/reservepackages.pdf`, gender specific
  `.../documents/genderspecificTender.pdf`, de-reservation of 17 packages `.../documents/17dereserve.pdf`.

## Haryana
- Status: VERIFIED-FILE (PDF)
- ayushmanbharat.haryana.gov.in -> Policy & Guidelines -> "HBP 2022":
  page `https://ayushmanbharat.haryana.gov.in/document/hbp-2022/` (table Title | Date | View,
  dated 19/06/2024, 4 MB) -> file
  `https://cdnbbsr.s3waas.gov.in/s3169779d3852b32ce8b1a1724dbf5217d/uploads/2024/06/20240619792610196.pdf`
  "Annexure - 1", columns: `Specialty Code | Specialty | Package Name | Procedure Name | Procedure
  code HBP 2.2 | Existing Procedure Price | Status with present package | National Reference Price
  (NRP) | Tier3 (Z) | Tier2 (Y) | ...`. 74 pages, 1882 unique procedure codes.
- chirayuayushmanharyana.in is only a premium/nominal-contribution collection portal (React app,
  two buttons: apply / check payment status). No package data.

## Himachal Pradesh (HIMCARE / HPSBYS)
- Status: VERIFIED-FILE (PDF)
- hpsbys.in -> Packages -> `https://www.hpsbys.in/content/p` -> "Health Benefit Package 2022
  under PMJAY and HIMCARE":
  `https://www.hpsbys.in/Application/uploadDocuments/content/latest%20package%20master.pdf_UpdCkFile_1781769968.pdf`
  (site links it as http://; https works, plain http curl failed).
  Columns: `Specialty | Specialty Code HBP 2022 | Package Code HBP 2022 | AB PMJAY Package Name |
  Procedure code HBP 2022 | procedure Name | Tier3 (Z) | Implant mapped | implant cost |
  Stratification Criteria (Y/N) | Stratification remarks | Multiple Procedures (Y/N) | Special
  Conditions (Y/N) | Reservation Public Hospital (Y/N)`. 144 pages, 1936 unique procedure codes.
  Only one price column (Tier3). No separate HIMCARE-specific rate directory found.

## Chandigarh
- Status: PORTAL-ONLY
- chandigarh.gov.in loaded. Tried: Schemes page (`https://chandigarh.gov.in/schemes` says
  "coming soon"), Departments -> Health (`https://chandigarh.gov.in/health`: GMSH-16 description,
  PDFs for CPIOs, pharma distributors, retail medicine shops only). No AB-PMJAY / package content
  on the admin portal. chdhealth.gov.in skipped per brief.

## Delhi (DGEHS)
- Status: VERIFIED-FILE (PDF, CGHS rate list adopted by DGEHS)
- dgehs.delhi.gov.in -> DGEHS menu -> "Approved Rates for Treatment and Investigative Procedures"
  -> `https://dgehs.delhi.gov.in/dghs/cghs-approved-rates-treatment-and-investigative-procedures`
  (HTML list of 5 PDFs). Main file:
  `https://dgehs.delhi.gov.in/sites/default/files/inline-files/cghs_rate.pdf`
  = CGHS OM F.No.5-16/CGHS(HQ)/HEC/2024(PartI) dated 03.10.2025, rates effective 13.10.2025.
  Annexure I split into Tier I / II / III cities. Columns: `Sr. No | CGHS Code | CGHS TREATMENT
  PROCEDURE/INVESTIGATION LIST | Non-NABH | NABH | Super Speciality | Speciality Classification`
  (sample: 1 CN001 Consultation OPD 350 350 350). 123 pages, ~2000 numbered rows per tier block.
  Older files on same page: cghs_approved_rates_2010.pdf,
  list_of_cghs_rates_2010_for_investigative_procedures.pdf, list_of_aiims_rates_for_treatment_procedures.pdf,
  list_of_aiims_rates_for_investigative_procedures.pdf (same /sites/default/files/inline-files/ path).

## Jammu & Kashmir (AB PM-JAY SEHAT)
- Status: PORTAL-ONLY
- jkpmjaysehat.co.in loaded; walked full nav (About, Hospitals, Media, Resources, Portals,
  Contact). Checked `orders.php` (government orders: SEHAT implementation, STG circular, SHA share),
  `notification.php`, `publication.php`, `codinator.php` (district coordinator directory). No HBP /
  package rate document on the site; hospital links go to hospitals.pmjay.gov.in / tms.pmjay.gov.in.
- hme.jk.gov.in loaded: only G.O. PDFs (promotions, appointments, one inquiry order on cardiology
  cases under AB PM-JAY SEHAT). No package data.

## Ladakh
- Status: VERIFIED-FILE (PDF)
- ladakh.gov.in: Health and Medical Education Department page has no scheme package content.
- nhmladakh.in home page -> "Health Benefit Package" link:
  `https://nhmladakh.in/HBP_2022.pdf`. 3801 pages (one row per page layout). Two blocks: a code
  crosswalk (`Specialty | Specialty Code HBP 2022 | Procedure Code HBP 2.0 | Procedure Code HBP
  1.0`) and a rate block (`Procedure code HBP 2022 | Procedure name | Tier3 (Z) | Tier2 (Y) |
  Tier1 (X) | Implant mapped`). 1937 unique procedure codes; ~2190 lines carry code + amount.

## Bihar (BISWASS)
- Status: VERIFIED-FILE (XLSX)
- biswass.bihar.gov.in -> "ABPMJAY Guidelines" -> `https://biswass.bihar.gov.in/pages/downloads.aspx`.
  Tier 2 workbook:
  `https://biswass.bihar.gov.in/Documents/guideline/HBP%202022%20Tier%202%20(SHA%20Bihar).xlsx`
  (HTTP 200, 1.66 MB). Sheet "Procedure sheet", 3125 rows. Headers: `Specialty | Specialty Code
  HBP 2022 | Package Code HBP 2022 | Procedure Code | Package Name | Procedure Name | Tier 2 |
  Implant Criteria (Y/N) | Stratification Criteria (Y/N) | Multiple Procedures | Special Conditions
  (Y/N) | Reservation Public Hospitals (Y/N) | Reservation Tertiary Hospitals (Y/N) | Level of Care
  | LOS | Auto Approved (Y/N) | Mandatory Documents - Pre Authorization | Mandatory Documents -
  Claim Processing | Procedure Label | ... | Medical or Surgical (S/M) | Day Care Procedure (Y/N) |
  Reserved Procedure (Insurance/Trust)`.
  Tier 3 link on the same page
  `https://biswass.bihar.gov.in/Documents/guideline/HBP%202022%20Tier%203%20(SHA%20Bihar).xlsx`
  returns HTTP 404 (both curl and browser).

## Jharkhand
- Status: PORTAL-ONLY
- `https://www.jharkhand.gov.in/health` loaded (Dept of Health, Medical Education & FW). Content is
  a document repository (Acts & Rules, Sankalp, Circular, Resolution, Notice, Sanction/Allotment
  orders, Publication). Scanned front page and Publication list: allotment orders in Hindi
  (incl. one for "स्वास्थ्य बीमा योजना" funding), no package/rate list. bis.jharkhand.gov.in
  skipped per brief.

## Summary
| Jurisdiction | Status |
|---|---|
| Rajasthan | VERIFIED-FILE (RGHS package master PDF, NABH/Non-NABH rates) |
| Uttar Pradesh | VERIFIED-FILE (SACHIS HBP-2022 PDF, tier rates) |
| Uttarakhand | VERIFIED-TABLE (per-speciality modal, 1622 rows) + HBP PDFs |
| Punjab | VERIFIED-FILE (HBP2.2 PDF) |
| Haryana | VERIFIED-FILE (HBP 2022 PDF on s3waas CDN) |
| Himachal Pradesh | VERIFIED-FILE (HBP 2022 package master PDF) |
| Chandigarh | PORTAL-ONLY |
| Delhi | VERIFIED-FILE (CGHS 2025 rate list PDF hosted by DGEHS) |
| Jammu & Kashmir | PORTAL-ONLY |
| Ladakh | VERIFIED-FILE (NHM Ladakh HBP_2022.pdf) |
| Bihar | VERIFIED-FILE (Tier 2 XLSX; Tier 3 link 404) |
| Jharkhand | PORTAL-ONLY |
