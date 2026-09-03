# Government scheme package-master sources, batch 1 (verified in a real browser, 2026-09-02)

Every URL below was loaded in Chrome (or fetched from within the site's own page context) and the
content inspected. Row counts are what was observed on the page or in the downloaded file, not guesses.

## Telangana (Rajiv Aarogyasri)
- Status: **PORTAL-ONLY** (partial: GO PDFs reachable only from inside the portal; the rate-list GOs are broken links)
- `https://aarogyasri.telangana.gov.in/` is a static "Verification Page" stub (no nav, zero links; `/ASRI/`, `/home`, `/packages` all 404).
  The live portal is `https://rajivaarogyasri.telangana.gov.in/` -> redirects to `https://rajivaarogyasri.telangana.gov.in/ASRI2.0/`.
- Navigation tried: full menu (About Us, Documents -> Bids/Guidelines/Process Flow/Empanelment/Board Resolutions/Government Orders, Hospitals -> Search by Speciality/Geography, Sitemap). No "Packages" / "Package Prices" / "Procedures" menu exists on ASRI2.0. Portal sub-pages are `ASRI2.0/portal/<id>.html`; `packages.html`, `procedures.html`, `packageprices.html`, `therapies.html` all 404. `publicViewsAction.do?actionVal=packages|Packages|packageList|therapies|procedures|PackagePrices` all return HTTP 200 with an empty body.
- Government Orders page (`https://rajivaarogyasri.telangana.gov.in/ASRI2.0/portal/govtorder.html`) is an HTML table (Type | Dept | Number | Date | Subject) listing the rate GOs:
  - G.O.Ms.No.30 (16.07.2024) "Revision of rates of existing procedures" (1375 procedures with annexures)
  - G.O.Ms.No.32 (16.07.2024) "Inclusion of (163) new procedures"
  - G.O.Ms.No.172 (24.10.2025) 668 Government-reserved procedures extended to Owaisi Hospital
  - G.O.Ms.No.87 (27.06.2013, AP) Input code book / Standard Schedule of Rates / Final Therapy Prices
- Attachments open via `fn_openAtach(file)` -> `https://rajivaarogyasri.telangana.gov.in/ASRI2.0/readAttachAction.do?actionVal=openAttachHome&fromPage=HomePage&attachMode=inline&filepath=<file>`.
  Direct navigation to that URL returns an "Oops...!! Something went wrong" Exception page; it only serves the PDF when requested from within the portal session (same-origin fetch / the site's own popup). Verified this way:
  - `filepath=Government_reserved_procedures_to_Owalsi_Hospital.pdf` -> 200 application/pdf, 133 KB. Content: the GO text only (no procedure table in it).
  - `filepath=GOMS87.pdf` -> 200 application/pdf, 1.6 MB, 318 pages. Content: 2013 AP input code book + Standard Schedule of Rates for inputs (drug codes like `G03GA01.PG.U0003` with unit prices; investigation codes like `I56.009 ERCP 5109`). Therapy price annexure ("Annexure 3") is referenced but NOT present in the file.
  - `filepath=MNJ_Procedures.pdf` -> 200 application/pdf, 832 KB (cancer procedures extended to MNJIO; not inspected further).
  - The two rate-list GOs (No.30, No.32) have commas/spaces in their filenames (`G..O.Ms.No. 30, rate revision of 1375 procedures with annexures.pdf`, `G.O.Ms.No.32, 163 new procedures with annexures.pdf`); every encoding variant fails at network level ("Failed to fetch") from the site's own page, so the site's own links to them are broken right now.
- Net: no package master with codes + amounts was reachable on the Telangana portal. Nearest thing is the GO index page above.

## Karnataka (SAST / Arogya Karnataka)
- Status: **VERIFIED-TABLE** (plus VERIFIED-FILE downloads)
- `https://sast.karnataka.gov.in/` is a login iframe (hConnect); the public site is `https://sast.karnataka.gov.in/sast/` (Kannada by default). Menu "ಯೋಜನೆಗಳ ಚಿಕಿತ್ಸೆಗಳು(ಪ್ಯಾಕೇಜ್)" / "Package" -> SAST.
- Table page: `https://sast.karnataka.gov.in/sast/arogya/package.php`
  - Form (POST to same URL): `search` = scheme (Ayushman Bharat - Arogya Karnataka, Rare and High cost disease, Jyothi Sanjeevini, Organ Transplant, Cochlear Implant, RBSK, Danta Bhagya), `dist` = Government | Private, `sname[]` = speciality multiselect (All + ~50 specialities).
  - Submitted AB-ArK + Private + All: HTML table `#example`, title row "Benefit Package of Ayushman Bharat - Arogya Karnataka Scheme", header row
    `Procedure Name | Speciality Name | Hospital Type | General Ward Rates | Semi-Private Rates | Private Rates | Pre-op Investigation | Post-op Investigation`.
    Procedure code is embedded in the first column, e.g. `3A.S15.17169A : VATS/Laparoscopy ( for deep seated biopsy) | SURGICAL GASTROENTEROLOGY | Private | 10000 | 0 | 0 | ...`.
    **3083 data rows** (3085 rows incl. title + header). Client-side search box, no pagination.
  - Same-page PDF export of the result: `https://sast.karnataka.gov.in/sast/arogya/pkpdf.php?psch=Ayushman%20Bharat%20-%20Arogya%20Karnataka&htype=Private&sname=` (200, application/pdf, 830 KB).
- File downloads from the SAST home page (all fetched, 200):
  - `http://www.sast.karnataka.gov.in/sast/Details/Package%20Master%203163.pdf` (KASS package master, application/pdf, 2.5 MB)
  - `https://sast.karnataka.gov.in/sast/Details/kass-npe-govt-package.pdf` and `.../kass-npe-private-hosp-package.pdf` (application/pdf, private one 3.7 MB)
  - `https://sast.karnataka.gov.in/sast/downloadpmrahatpackage.php` (PM RAHAT package, **xlsx**, application/vnd.openxmlformats..., 115 KB)
  - `https://sast.karnataka.gov.in/sast/Details/Organ%20transplant%20package.pdf`
- `https://arogya.karnataka.gov.in` -> `/Forms/frmLogin.aspx` login page only; no public package data.

## Tamil Nadu (CMCHIS)
- Status: **VERIFIED-TABLE** (React SPA backed by a public JSON API)
- Home -> "For Administrators" -> "Scheme Health Benefit Packages" -> `https://www.cmchistn.com/administrators/procedure-list`
  - Tabs: Breakup | Package Rates | Reserved for Government | Preauth / Claims | Neonatology | STGs.
  - Breakup tab: Category | Count table: Surgical 686, Medical 215, Interventional Radiology 36, Diagnostic 23, Government Reserved 56, Follow-up 113 (1,016 total excl. follow-up).
  - Package Rates tab: "Showing 10 of 4,302 records", 10/page pagination, search, Filters. Columns
    `Package | Category | A1 | A2 | A3 | A4 | A5 | A6 | S1 | S2` (hospital grades). Example row: `CMU0001 : CORONARY BALLOON ANGIOPLASTY (PPCI) | INTERVENTIONAL CARDIOLOGY | ₹50,400 x8`; `CMU0003 : ADDITIONAL STENT FOR PTCA | ... | ₹18,700 | ₹18,700 | ₹16,850 ...`.
- Backing API (observed in network panel, fetched directly, CORS-open, paginated):
  `https://chtn.cmchistn.com/api/v1/package-rate-master-new/?page=1&page_size=10` -> `{count:4302, next, results:[{id, package:"CMU0001 : CORONARY BALLOON ANGIOPLASTY (PPCI)", category, a1..a6, s1, s2, a110, a120, category_tamil, year:"2022"}], table_headers:[...]}`.
  Filter options: `https://chtn.cmchistn.com/api/v1/package-rate-master-new/filter-options/`.
- `https://www.cmchistn.com/package_master` is a soft-404 (not used).

## Kerala (KASP / MEDISEP)
- Status: **VERIFIED-FILE** (KASP) and **VERIFIED-TABLE** (MEDISEP, no codes)
- SHA Kerala `https://sha.kerala.gov.in/` -> Latest -> Notifications: `https://sha.kerala.gov.in/?page_id=1097&lang=en` lists "Latest HBP2.0 Package":
  - `https://sha.kerala.gov.in/wp-content/uploads/2021/07/Kerala-HBP-2.0_08072021.xls` -> 200, application/vnd.ms-excel, 3.2 MB (BIFF .xls, last saved 08 Jul 2021).
    Sheets: Procedure Master, Procedure vs SP POP UP Mapping, Procedure Vs SP Rule Mapping, Stratification vs Procedure Map, Implant vs Procedure Mapping, Follow Up to Procedure, Investigation VS Procedure Mapping, Unspecified Surgical Package.
    Header strings present: Procedure Code, Procedure Name, Package Code, Package Name, Package Price. HBP 2.0 style codes (`MC003A`, `MC003B`, ...), ~1495 code strings in the file. NB: dated 2021 (HBP 2.0), not the current HBP 2022.
  - Same page also has `HBP 2.0 User Guidelines` PDF and STG circulars. Government Orders page (`?page_id=1107`) has only COVID/KMSCL rate GOs. "For Hospitals" (`?page_id=1141`) is a DPC contact list only.
- MEDISEP `https://medisep.kerala.gov.in/` -> Hospitals -> Packages: `https://medisep.kerala.gov.in/Package.jsp`
  - Speciality dropdown (`type`, ~45 specialities) then the page reloads as `https://medisep.kerala.gov.in/Package.jsp?click,<Speciality>` (verified with `?click,Cardiology`: 35 entries, DataTable 10/page, PDF export button).
  - Columns: `Sl No | Package Name | Procedure Name | Length of Stay | Implant Mapped | Implant Cost (maximum payable) | Normal Rate (Hospital Without Quality Certification) | Base Rate (Entry Level Certification, 5% more) | Accreditation Rate (Full NABH, 10% more) | Add on applicable | Procedure Label | Medical or Surgical (S/M)`.
    Example: `1 | Right / Left Heart Catheterization | Right Heart Catheterization | 2 | NA | NA | 17250 | 18750 | 22500 | NO | Regular Procedure | Medical`. **No procedure codes** in this table.
  - Second table on the same page: Catastrophic Packages (`Sl No | Package Name | Amounts | Conditions`, 10 rows, e.g. Liver Transplantation 1800000).

## Puducherry
- Status: **PORTAL-ONLY**
- `https://health.py.gov.in/` (Drupal). Tried: AB-PMJAY menu (`/ab-pmjay`: 4 items only: AYUSH society posts x2, "Implementation of AB-PMJAY - Convergence of UT run Medical assistance Scheme with Central Govt Scheme" order 06/02/2021, "AB-PMJAY STATUS REPORT" 07/01/2021), Programmes & Schemes (`/programmes-schemes`), Pensioners Health Insurance, Contributory Medical Benefit Scheme, site search `/search/node/package` (no hits). No package/procedure list or rate file on the site. Puducherry runs on the national PM-JAY HBP (see NHA section).

## Goa (DDSSY)
- Status: **PORTAL-ONLY**
- `https://goaonline.gov.in/` is the e-services portal: only DDSSY items are "New Enrollment" (`/Appln/UIL/DeptServices?__DocId=DHS&__ServiceId=DHS01`), "Renew DDSSY Card 2026-27" (`...DHS02`) and `https://goaonline.gov.in/DDSSYCardStatus`. Those pages are application forms/status lookups; no package or rate data. `ddssy.goa.gov.in` does not resolve (ERR_NAME_NOT_RESOLVED); `dhsgoa.gov.in` skipped as instructed.

## Gujarat (MA / MA Vatsalya / AB-PMJAY)
- Status: **VERIFIED-FILE** (PDF; per-cluster PDFs embedded in HTML pages)
- `https://ma.gujarat.gov.in/PackageRates.html` ("PACKAGE RATES" top-nav item): left list "PackageRates-MA&AB-PMJAY" + 23 speciality clusters. No HTML table on the page.
  - All-in-one download: `https://ma.gujarat.gov.in/documents/Clusters/All_Procedures.pdf` -> 200, application/pdf, 2.7 MB, **160 pages**.
    Columns (per cluster): `Sr.No | Package No | Sub Speciality | Procedure Name | Pre-Operative Investigation | Post Operative Investigation | No of Follow up | Package Rates | Remarks | Speciality Code | Procedure Code PMJAY`. Rows like `1 | 1.1 | Burns | 20% burns or scalds... | Clinical Photograph | Clinical Photograph | 3 | <rate> ...`; e.g. `39 | 1.39 | Plastic Surgery | NPWT (Inpatient only)(Per day Package Amount) | ... | 2,000 | per day`.
  - Per-cluster pages: `https://ma.gujarat.gov.in/Cluster-1%20BURNS%20AND%20PLASTIC%20SURGERY.html` ... `Cluster-25%20NEO%20NATAL%20PACKAGES.html` (23 links), each just an iframe of `https://ma.gujarat.gov.in/documents/Clusters/Cluster-<n>%20<NAME>.pdf`.
- `https://gujhealth.gujarat.gov.in` not needed (MA site had the data); not loaded.

## Madhya Pradesh
- Status: **PORTAL-ONLY**
- `https://health.mp.gov.in/` -> `/en`. Tried: "Ayushman Bharat Yojna" (`https://www.health.mp.gov.in/node/5761/`: 2018 tender/RFP, circulars on empanelment/training, all pre-launch 2018 PDFs), Policies/Schemes (`/en/node/3371`: investment/transfer/drug policies), Download Forms (`/en/download-forms-0`), Hospital Administration. Every Ayushman link points to `http://www.ayushmanbharat.mp.gov.in/` (unreachable, skipped as instructed). No package list on health.mp.gov.in.

## Chhattisgarh (SVNSASY / ex-DKBSSY)
- Status: **VERIFIED-FILE** (PDF)
- `https://govthealth.cg.gov.in/sna/` -> top menu "Documents" -> `https://govthealth.cg.gov.in/sna/Gov_orders.aspx` (HTML table: Title | Click Here) with rows "Health Benefit Packages 2.0 User Guidelines", "Neonatal Package Guidelines", "Government Reserved Packages", "Package List".
  - Package List: `https://govthealth.cg.gov.in/sna/documents/package_master.pdf` -> 200, application/pdf, 3.1 MB, **111 pages**, titled "HBP 2.2 Chhattisgarh". Columns:
    `Specialty | Package Code HBP 2.2 | AB PM-JAY Package Name | Multiple Procedures | Procedure Code HBP 2.2 | AB PM-JAY Procedure Name | Package Price | Stratification Criteria (Y/N) | Implants/High End Consumables (Y/N) | Reservation Public Hospitals (Y/N) | LOS | Auto Approved (Y/N)`.
  - Government Reserved Packages: `https://govthealth.cg.gov.in/sna/documents/govt_reserved_packages.pdf` -> 200, application/pdf, 409 KB.
  - HBP 2.0 user guidelines: `https://govthealth.cg.gov.in/sna/documents/HBP_2.0_User_Guidelines.pdf`.
- "Standard Treatment Guideline(STG)" page `https://govthealth.cg.gov.in/sna/Guidelines.aspx` has per-procedure STG PDFs only.

## Central / PM-JAY (National Health Authority)
- Status: **VERIFIED-FILE** (PDFs)
- `https://nha.gov.in/` (Angular). Top nav "Repository" (click, not hover) -> "Guidelines/OMs/Manuals" -> left category list -> "Health Benefits Packages":
  `https://nha.gov.in/DocumentsResource?documents=Health+Benefits+Packages%7ED` (direct URL works).
  Documents listed there (all `https://nha.gov.in/strapi/uploads/...`):
  - `HBP_2022_14bf060cbb.pdf` ("HBP2022.pdf", released 06 Apr 2022) -> 200, application/pdf, 2.4 MB, **203 pages**. Annexure-1 table columns:
    `SL NO | Specialty | Specialty Code HBP 2022 | Package Code HBP 2022 | AB PMJAY Package Name | Procedure code HBP 2022 | Procedure Name | National Reference Price (NRP) | Tier3 (Z) | Tier2 (Y) | Tier1 (X) | Implant mapped | implant cost | Stratification Criteria (Y/N) | Stratification remarks`. ~1894 HBP-style code tokens (`XX000X`) in the extracted text.
  - `National_Master_Health_Benefit_packages_2_2_76024f463a.pdf` (HBP 2.2 master) -> 200, application/pdf, 907 KB, **55 pages**. Columns: `Specialty Code HBP 2.0 | Specialty | Package Code HBP 2.1 | AB PM-JAY Package Name | Procedure Code | AB PM-JAY Procedure Name | Procedure Price | Stratification | Implant | Total Package Price`.
  - Also on the page: `National_Master_Health_Benefit_Packages_2_1_f33202b683.pdf`, `Health_Benefit_Package_2_0_08f7ac5fa0.pdf`, `Health_benefit_Packages_1_0_a2f1170337.pdf`, `User_guidelines_for_HBP_2_2_6d2bc0412a.pdf`, `HBP_2_0_User_Guidelines_v_Final_046b201e6f.pdf`, `National_Health_Benefits_Packages_Guidelines_fceb804a58.pdf` (17 Apr 2026), `NHA_HBP_Manual_Part_2_Final_July_2026_7c429b3de2.pdf` (Jan/Jul 2026), `Policy_document_for_Unspecified_Surgical_Package_1703e61702.pdf`, `Ayushman_Bharat_PM_JAY_Exclusion_Policy_75e9e01599.pdf`.
  - No xlsx/csv master on nha.gov.in; the header button "HBP New Inclusion" was not followed. pmjay.gov.in unreachable (skipped).

## One-line summary
| Jurisdiction | Status | Best source |
|---|---|---|
| Telangana | PORTAL-ONLY | GO index `ASRI2.0/portal/govtorder.html`; rate GOs' PDF links broken |
| Karnataka | VERIFIED-TABLE | `sast/arogya/package.php` (POST form, 3083 rows) + PDF/xlsx downloads |
| Tamil Nadu | VERIFIED-TABLE | `/administrators/procedure-list` Package Rates tab; API `chtn.cmchistn.com/api/v1/package-rate-master-new/` (4302) |
| Kerala | VERIFIED-FILE / TABLE | `Kerala-HBP-2.0_08072021.xls` (KASP, 2021); MEDISEP `Package.jsp?click,<Spec>` (no codes) |
| Puducherry | PORTAL-ONLY | nothing on health.py.gov.in; uses national HBP |
| Goa | PORTAL-ONLY | goaonline.gov.in has enrollment/status only |
| Gujarat | VERIFIED-FILE | `documents/Clusters/All_Procedures.pdf` (160 pp) + 23 cluster PDFs |
| Madhya Pradesh | PORTAL-ONLY | health.mp.gov.in has 2018 circulars only; data lives on unreachable ayushmanbharat.mp.gov.in |
| Chhattisgarh | VERIFIED-FILE | `sna/documents/package_master.pdf` (HBP 2.2 CG, 111 pp) |
| Central / PM-JAY | VERIFIED-FILE | nha.gov.in `HBP_2022_14bf060cbb.pdf` (203 pp) + HBP 2.2 master PDF |
