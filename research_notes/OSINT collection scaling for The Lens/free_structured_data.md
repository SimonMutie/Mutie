# Free/Open Structured Data Sources for Conflict, Security & Humanitarian Monitoring

## Is ACLED's full dataset genuinely free for a commercial consultancy like Afrilens, and what are the restrictions?

### Takeaway
ACLED is **not** free-for-all for commercial use. Its EULA explicitly requires commercial entities to obtain a separate corporate/paid license before accessing content or the API, and it specifically bars using ACLED content to build or support a competing product or service — a real risk for a conflict-analysis consultancy. Registration is mandatory even for the free/non-commercial track.

### Cited Findings
- ACLED's EULA states: "Commercial entities may not access or use the Content and/or Platforms without first obtaining a corporate license." — [ACLED EULA](https://acleddata.com/eula)
- The free/standard license granted is "royalty-free, non-exclusive, non-transferable, non-sublicensable" and is scoped to non-commercial purposes; commercial users must negotiate separately with ACLED. — [ACLED EULA](https://acleddata.com/eula)
- The EULA forbids using ACLED content "to develop, train, support, or assist in the development of any product or service that is competitive with Licensor's products or services." — [ACLED EULA](https://acleddata.com/eula)
- ACLED's separate Content Usage Terms prohibit using the data "to provide services to or for any other person, entity, or organization without authorization," and ban creating "any dataset, product, or platform that competes with, or creates a functional substitute for" ACLED's own content/products. — [ACLED Content Usage Terms](https://acleddata.com/contentusage)
- Users of ACLED content must "maintain accurate and faithful representation of ACLED's data, analysis, and methodology" and disclose any manipulation of the data for analysis. — [ACLED Content Usage Terms](https://acleddata.com/contentusage)
- Full data access (export tool, curated data files, or API) requires registering for an account on the ACLED Access Portal ("myACLED"). — [ACLED FAQ: How can I access and use ACLED data?](https://acleddata.com/faq/how-can-i-access-and-use-acled-data)
- ACLED maintains dedicated Terms of Use/Attribution/Access FAQ and myACLED FAQ documents that govern specifics of the registration/access model (not fully extracted in this pass; see Gaps). — [ACLED Terms of Use & Attribution/Access FAQs (2023, PDF)](https://acleddata.com/sites/default/files/wp-content-archive/uploads/2023/07/ACLED_Terms-of-Use-Attribution-Access_FAQs_2023.pdf); [FAQs: ACLED Registration System and Access Model (PDF)](https://acleddata.com/sites/default/files/wp-content-archive/uploads/2020/10/FAQs-ACLED-Registration-and-Access-Model.pdf); [myACLED FAQs](https://acleddata.com/myacled-faqs)
- ACLED is also listed as a paid/licensed data provider on third-party data marketplaces (Datarade), consistent with a non-free commercial track existing alongside the free academic/non-commercial track. — [ACLED Data on Datarade](https://datarade.ai/data-providers/acled-data/profile)

### Inferences
- Afrilens Consulting, as a for-profit conflict-analysis consultancy producing client-facing deliverables, almost certainly falls under "commercial entity" in ACLED's EULA, meaning ingesting ACLED data at volume into The Lens and republishing/analyzing it for paying clients likely requires a paid corporate license — the free registration path is probably not sufficient or compliant for this use case.
- Because ACLED explicitly prohibits building a "functional substitute" or competing platform, a crisis-monitoring product that re-packages ACLED event data for clients is squarely the use case ACLED's terms are designed to monetize/control — this is the single biggest licensing risk in the whole source list and should be resolved directly with ACLED (contact them per the EULA) before any high-volume ingestion.

### Gaps
- Exact pricing/cost tiers for ACLED's commercial/corporate license were not found in this pass (ACLED does not appear to publish list pricing; it requires direct contact). This needs a follow-up email/inquiry to ACLED's licensing contact, not a web search.
- API-specific rate limits for ACLED (separate from the general EULA) were not confirmed in this pass — the API Getting Started page exists (https://acleddata.com/api-documentation/getting-started) but was not fetched in depth due to tool-call budget.

---

## Does UCDP (Uppsala Conflict Data Program) allow high-volume commercial ingestion, and what's its African granularity?

### Takeaway
UCDP is genuinely free with no commercial-use restriction found, has a documented API with a generous but defined rate limit (5,000 requests/day), and provides bulk downloads plus a Georeferenced Event Dataset (GED) with event-level geographic coordinates that includes African conflicts — making it one of the cleanest, lowest-risk sources on this list.

### Cited Findings
- UCDP's API is described as "free of charge," positioned as part of UCDP's "commitment to open and accessible research infrastructure." — [UCDP API documentation](https://ucdp.uu.se/apidocs/)
- The API enforces a rate limit of 5,000 requests per day, and errors count toward that limit. — [UCDP API documentation](https://ucdp.uu.se/apidocs/)
- UCDP also offers a full bulk Dataset Download Center distinct from the API. — [UCDP Dataset Download Center](https://ucdp.uu.se/downloads/)
- The UCDP Georeferenced Event Dataset (GED), accessible via the API, provides event records with latitude/longitude coordinates, supporting geographic filtering/querying. — [UCDP API documentation](https://ucdp.uu.se/apidocs/)
- Community-maintained R packages exist for programmatic UCDP access (`ucdp.api`), indicating an established API ecosystem beyond the raw endpoint. — [guyschvitz/ucdp.api (GitHub)](https://github.com/guyschvitz/ucdp.api); [chris-dworschak/ucdp.api (GitHub)](https://github.com/chris-dworschak/ucdp.api)

### Inferences
- The 5,000 requests/day cap is high enough to support a daily or even sub-daily full refresh of UCDP's event data via the API for an African-focused subset, without needing to scrape or bulk-download on every run; bulk files remain the better choice for full historical backfills.

### Gaps
- UCDP's specific data license text (e.g., Creative Commons variant, attribution requirement wording) and any explicit statement on commercial/for-profit use were not located in this pass — the API docs emphasize "free of charge" and "open... research infrastructure" but a dedicated terms-of-use/license page should be checked directly (likely linked from ucdp.uu.se) to confirm no non-commercial clause exists, since "research infrastructure" framing could imply an academic/research-use expectation even if not a hard legal restriction.
- Update frequency (how often UCDP's live/candidate-events feed vs. the annual GED release refreshes) was not confirmed in this pass.

---

## Is HDX (Humanitarian Data Exchange) usable at high volume commercially, and what are its API/rate-limit/license terms?

### Takeaway
HDX hosts data under multiple distinct licenses set by each contributing organization (not a single blanket HDX license), so commercial eligibility must be checked per-dataset; HDX also runs a newer "HAPI" (Humanitarian API) with its own Terms of Service. This pass could not directly confirm licensing/rate-limit specifics due to a fetch block, and it is flagged as a gap requiring a follow-up read.

### Cited Findings
- HDX publishes a dedicated "Data Licenses Explained" page indicating datasets carry varying licenses rather than one uniform HDX-wide license. — [Data Licenses Explained](https://data.humdata.org/faqs/licenses)
- HDX operates a distinct "HAPI" (Humanitarian API) product with its own Terms of Service page, separate from the general HDX platform ToS. — [HAPI Terms of Service](https://data.humdata.org/hapi/terms); [HDX HAPI documentation](https://hdx-hapi.readthedocs.io/)
- HDX also has a general platform Terms of Service and a separate FAQ-based Terms of Service page, suggesting overlapping/legacy documentation that should be reconciled. — [Terms of Service - HDX FAQ](https://data.humdata.org/faqs/terms); [HDX Terms of Service (docs.humdata.org)](https://docs.humdata.org/about/hdx-terms-of-service)

### Inferences
- Because HDX is a data-hosting platform aggregating datasets from many organizations (OCHA, ACAPS, IPC/Cadre Harmonisé, FEWS NET mirrors, etc.), the safest approach for Afrilens is to check the license field on each specific dataset/resource page it plans to ingest (many HDX datasets use CC-BY or CC0-type open licenses, but this must be verified per dataset rather than assumed platform-wide).

### Gaps
- Direct fetch of the HDX licenses and HAPI terms pages failed (403 error) in this pass; a follow-up fetch (ideally via a different path, e.g. Google cache, or direct browser check) is needed to confirm: (a) whether CC-BY/CC0 is the dominant license for HDX-hosted African conflict/humanitarian datasets, (b) HAPI's specific rate limits, and (c) whether HAPI terms impose any commercial restriction.
- Did not confirm update frequency for HDX/HAPI in this pass.

---

## What are ACAPS's terms, update frequency, and API/download options — including the Humanitarian Access Overview?

### Takeaway
ACAPS publishes most analytical products (including the Humanitarian Access Overview) as free downloadable datasets via its own site and via HDX, and maintains a dedicated API subdomain (api.acaps.org), but this pass could not confirm ACAPS's specific license text or commercial-use terms — flagged as a gap.

### Cited Findings
- ACAPS publishes a recurring "Humanitarian Access Overview" product/dataset directly on its site, with historical editions (e.g., December 2020, July 2022) available as distinct dataset releases. — [Humanitarian Access Overview dataset (July 2022)](https://www.acaps.org/humanitarian-access-overview-dataset-july-2022); [Humanitarian Access Overview - December 2020](https://www.acaps.org/humanitarian-access-overview-december-2020); [View Key Document](https://www.acaps.org/key-document/humanitarian-access-overview)
- ACAPS mirrors its Humanitarian Access Dataset on HDX. — [Humanitarian Access Dataset - HDX](https://data.humdata.org/dataset/acaps-humanitarian-access-dataset)
- ACAPS maintains its own organizational presence and multiple datasets on HDX. — [ACAPS - HDX organization page](https://data.humdata.org/organization/acaps); [ACAPS Humanitarian Data](https://data.humdata.org/organization/0974463c-5419-4e89-9b55-90e035074ccf)
- ACAPS operates a dedicated API subdomain. — [api.acaps.org](https://api.acaps.org/)
- ACAPS also provides a browsable datasets interface directly on its main site. — [ACAPS Data page](https://www.acaps.org/en/data?tx_acapspackage_datasetlist%5Baction%5D=show&tx_acapspackage_datasetlist%5Bcontroller%5D=Dataset&tx_acapspackage_datasetlist%5Bdataset%5D=13&cHash=af153eee728a6db85ed4108eb9dba86f)

### Inferences
- Given ACAPS's historical pattern of releasing periodic (not real-time) dataset editions (e.g., access overview updates every several months to roughly annually based on the dated releases found), ACAPS is better suited to The Lens as a periodic/batch ingestion source rather than a high-frequency real-time feed.

### Gaps
- ACAPS's specific license/ToS text and explicit commercial-use policy were not retrieved in this pass (the api.acaps.org root and ACAPS ToS pages were not fetched for content). Needs a direct fetch of ACAPS's terms-of-use/licensing page before high-volume ingestion.
- Exact update cadence of the core ACAPS API (vs. the periodic named reports) not confirmed.

---

## What are FEWS NET's API terms, update frequency, license, and does it include IPC-compatible classifications for Africa?

### Takeaway
FEWS NET operates a documented REST API (FDW — FEWS Data Warehouse) with Swagger/interactive docs, covering IPC-compatible acute food insecurity classifications with confirmed African country examples (Ethiopia, Kenya), but this pass could not confirm explicit rate limits, license terms, or commercial-use policy — flagged as a gap requiring direct Help Desk / ToS follow-up.

### Cited Findings
- FEWS NET's API documentation (FDW — FEWS Data Warehouse) includes endpoints for "Acute Food Insecurity Classifications" and "Acutely Food Insecure Population Estimates," with example queries referencing Ethiopia and Kenya. — [FEWS NET API](https://help.fews.net/fdw/fews-net-api)
- A second/legacy documentation path exists under a different subdomain naming convention ("fde"). — [FEWS NET API (fde)](https://help.fews.net/fde/fews-net-api)
- FEWS NET publishes a "Data Attribution" page, implying attribution is a required or expected condition of reuse. — [Data Attribution](https://fews.net/data-attribution)
- FEWS NET (USAID-run) has publicly discussed modernizing its data infrastructure toward more open, analysis-ready data (per its own blog), suggesting an active push toward broader API/data accessibility. — [Secure, Open, Intuitive: The Blueprint for Analysis-Ready Data](https://medium.com/@fewsnet/secure-open-intuitive-the-blueprint-for-analysis-ready-data-6dd866b8b68a); [Beyond Numbers: USAID's FEWS NET Data Unlocks Actionable Insights](https://medium.com/@fewsnet/beyond-numbers-usaids-fews-net-data-unlocks-actionable-insights-02e808d0adcf)
- A separate project (OCHA-DAP) maintains a daily mirror of FEWS NET's IPC-compatible acute food insecurity classifications from the FDW into its own database/blob store with a GitHub Pages explorer — evidence the underlying FEWS NET data updates at least daily (or that this mirror polls daily) and that third parties already treat it as a reliable ingest source. — [OCHA-DAP/ds-fewsnet-mirror (GitHub)](https://github.com/OCHA-DAP/ds-fewsnet-mirror)
- FEWS NET's primary acute food insecurity classification data is also browsable directly. — [Acute Food Insecurity Classifications](https://fews.net/data/acute-food-insecurity)

### Inferences
- The existence of a third-party "daily mirror" project (OCHA-DAP) strongly suggests FEWS NET's FDW API is stable enough and permissive enough for repeated automated daily polling without an access request, which is a good practical signal even without a confirmed written rate limit — Afrilens could study ds-fewsnet-mirror's ingestion code as a reference implementation.

### Gaps
- No explicit rate limit or formal commercial-use clause was found for the FEWS NET API in this pass; the Help Desk/ToS referenced by the documentation should be consulted directly (note: FEWS NET is a USAID-funded program whose future/continuity status should also be separately verified given general USAID funding uncertainty in 2025–2026, though this was not directly researched here).

---

## What are ReliefWeb's API terms, update frequency, rate limits, and license?

### Takeaway
ReliefWeb's API updates in real time as content is posted and is one of the more commonly used open UN OCHA data feeds, but specific rate-limit and commercial-license details were not retrievable in this pass from the fetched page and should be confirmed from the full Terms of Service before high-volume use.

### Cited Findings
- ReliefWeb's API updates "In real-time, every time content is added to ReliefWeb." — [ReliefWeb API](https://reliefweb.int/help/api)
- Full ReliefWeb API documentation, including request parameters and result structure, is published separately at a dedicated API docs subdomain. — [Reliefweb API - Documentation](https://apidoc.reliefweb.int/); [Reliefweb API Request Parameters](https://apidoc.reliefweb.int/parameters); [ReliefWeb API Result structure](https://apidoc.reliefweb.int/result-structure)
- Third-party client libraries exist for ReliefWeb's API in PHP and Rust, indicating a stable, widely-integrated public API. — [reliefweb/api-php-client](https://packagist.org/packages/reliefweb/api-php-client); [reliefweb (Rust crate)](https://crates.io/crates/reliefweb)

### Gaps
- Rate limits, registration requirements, and explicit commercial-use terms for the ReliefWeb API were not found in the fetched excerpt; the "Terms of Service" referenced on the help page needs a direct, separate fetch/read.

---

## Does CrisisWatch (International Crisis Group) offer a bulk/API feed, and what's its license?

### Takeaway
CrisisWatch is primarily a browsable/searchable database and monthly report product rather than a confirmed open API or bulk-download dataset; no evidence of a public API or documented bulk-download license was found in this pass, making it a low-priority/manual-reference source rather than a high-volume ingestion candidate pending further confirmation.

### Cited Findings
- CrisisWatch is described by Crisis Group as a tool tracking developments "in over 70 conflicts and crises," organized as a searchable database with monthly updates and a PDF archive. — [CrisisWatch Database](https://www.crisisgroup.org/crisiswatch/database); [CrisisWatch PDF Archive](https://www.crisisgroup.org/crisiswatch/crisiswatch-pdf-archive); [About CrisisWatch](https://www.crisisgroup.org/about-crisiswatch)
- No official CrisisWatch API or bulk-download endpoint was found in search results; results instead surfaced a third-party/community GitHub project ("CrisisWatchAI") and an unrelated Crisis Group GitHub data repo for a specific conflict (Donbas), not a general CrisisWatch API. — [opeblow/CrisisWatchAI (GitHub, third-party, unverified)](https://github.com/opeblow/CrisisWatchAI); [Crisis Group Donbas Data Repository (GitHub)](https://crisisgroup.github.io/donbas-data-repo/)

### Inferences
- Without a documented API or bulk file, scaled ingestion of CrisisWatch would likely require web scraping, which carries its own ToS risk given Crisis Group has not published machine-access terms found in this research — this should be treated as a manual/periodic qualitative-reference source rather than part of the automated high-volume pipeline until Crisis Group's ToS is directly checked.

### Gaps
- Crisis Group's general website Terms of Use (governing scraping/reuse of CrisisWatch content) were not fetched in this pass.
- Could not confirm whether Crisis Group offers any non-public data-licensing arrangement for CrisisWatch to commercial clients.

---

## What is IPC's (Integrated Food Security Phase Classification) API/data access, update model, and does it allow commercial use?

### Takeaway
The IPC launched a dedicated API (including a joint Cadre Harmonisé–IPC API for West Africa/the Sahel) enabling real-time programmatic access to classification data covering 30+ countries (45+ for the CH-IPC component), with strong African depth, but explicit commercial-use terms require reading the separately-linked "IPC-CH API Terms of Use," which this pass could not fetch in full.

### Cited Findings
- The IPC "Launches Application Programming Interface (API) to Bolster Data Access," per IPC's own announcement. — [The IPC Launches Application Programming Interface (API) to Bolster Data Access](https://www.ipcinfo.org/ipcinfo-website/featured-stories/news-details/en/c/1155546/)
- The IPC API "allows applications and websites to receive data in real-time" and covers over 30 countries of IPC implementation, with plans for expansion. — [The IPC Application Programming Interface](https://www.ipcinfo.org/ipc-country-analysis/api/)
- A specific Cadre Harmonisé (CH)–IPC joint API exists, covering "more than 45 countries facing food crises," concentrated in West Africa and the Sahel, enabling access to population tables and maps in GeoJSON and Vector Tile formats. — [The Cadre Harmonisé (CH)-Integrated Food Security Phase Classification (IPC) API (ReliefWeb)](https://reliefweb.int/report/world/cadre-harmonise-ch-integrated-food-security-phase-classification-ipc-application-programming-interface-api)
- IPC/Cadre Harmonisé data is also separately mirrored on HDX, including a West & Central Africa-specific dataset page. — [West & Central Africa Food Security Data - Cadre Harmonise (CH) and IPC data (HDX)](https://data.humdata.org/dataset/cadre-harmonise); [IPC Humanitarian Data (HDX org page)](https://data.humdata.org/organization/ipc)
- IPC data is also catalogued via FAO's own open-data catalog. — [Integrated Food Security Phase Classification - IPC Info Tool (FAO data catalog)](https://data.apps.fao.org/catalog/dataset/ipc-info-tool)
- The IPC API page explicitly references a distinct "IPC-CH API Terms of Use" document governing usage. — [The IPC Application Programming Interface](https://www.ipcinfo.org/ipc-country-analysis/api/)

### Inferences
- IPC/Cadre Harmonisé together provide unusually strong, standardized African food-security granularity (covering both the IPC's broader country set and the CH's West Africa/Sahel-specific 45-country set), and because they're mirrored on HDX as well as the primary IPC/FAO sites, Afrilens has at least three redundant ingestion paths (direct IPC API, HDX dataset, FAO catalog) to choose from for resilience.

### Gaps
- The actual text of the "IPC-CH API Terms of Use" (commercial use, rate limits) was not fetched in this pass — this is a short, important follow-up given IPC is a multi-agency (FAO/WFP/FEWS NET/etc.) partnership and may have a cleaner, more standard open-data license than ACLED, but this must be confirmed rather than assumed.

---

## Beyond the already-known GDELT DOC 2.0 API and Event Export, what additional free, high-volume GDELT products exist?

### Takeaway
GDELT offers several underused, fully free products beyond the Event database: the Global Knowledge Graph (GKG, updating every 15 minutes with thematic/tone/count data including deaths and displacement), the Visual Global Knowledge Graph (VGKG) for image-based narrative analysis, the Global Entity Graph (GEG) and Visual GEG for AI-annotated entity extraction across 100M+ articles, Television Ngrams/Global Frontpage Graph/Global Geographic Graph, and access via Google BigQuery for large-scale SQL querying — all described by GDELT as "100% free and open," with no new rate-limit regime beyond what's already understood for DOC 2.0/Event Export.

### Cited Findings
- GDELT 2.0 Event and GKG databases update "every 15 minutes." — [The GDELT Project — Data page](https://gdeltproject.org/data.html)
- GDELT's Global Knowledge Graph (GKG) includes "counts data tracking deaths, displaced persons, and disease impacts" — directly relevant to humanitarian/conflict severity signals beyond raw event records. — [The GDELT Project — Data page](https://gdeltproject.org/data.html)
- The Visual Global Knowledge Graph (VGKG) applies "Google's most powerful deep learning algorithms to global news imagery" for real-time visual narrative processing — this is the "Television/VGEM visual media tracking" product referenced in the research brief, though GDELT frames it as VGKG rather than a separately named "VGEM." — [The GDELT Project — Data page](https://gdeltproject.org/data.html)
- The Global Entity Graph (GEG) and its visual counterpart annotate "more than 100 million news articles" via AI, with video analysis covering American television news over roughly the past decade. — [The GDELT Project — Data page](https://gdeltproject.org/data.html)
- Additional GDELT products include the Global Frontpage Graph (50,000 news outlets tracked hourly), the Global Difference Graph (tracks article edits over time), Television Ngrams and Web Ngrams (152 languages), the Global Geographic Graph (1.6+ billion location mentions — potentially useful for geocoding African event mentions beyond ACLED/UCDP-style structured coding), and the Global Quotation Graph (multilingual quoted statements). — [The GDELT Project — Data page](https://gdeltproject.org/data.html)
- All GDELT datasets are described as "100% free and open," accessible via the GDELT Analysis Service (browser), Google BigQuery (SQL), or direct CSV bulk downloads. — [The GDELT Project — Data page](https://gdeltproject.org/data.html)
- GDELT 1.0 updates daily while GDELT 2.0 refreshes every 15 minutes and covers "events reported in articles published in the 65 live translated languages" — this 65-language live-translation layer is GDELT Translingual, directly relevant to non-English African-language and francophone/arabophone source coverage. — [The GDELT Project — Data page](https://gdeltproject.org/data.html)

### Inferences
- The GKG's built-in casualty/displacement "counts" extraction and the Global Geographic Graph's location-mention volume could both serve as useful cross-validation or early-warning signals layered on top of The Lens's existing GDELT Event/DOC 2.0 ingestion, without requiring any new registration, key, or rate-limit negotiation — since GDELT already treats all these as part of the same free, open, high-volume data firehose.
- GDELT Translingual (the 65-language live-translation pipeline powering GDELT 2.0) means francophone and arabophone African media are already being captured and translated into the existing Event/GKG streams — worth explicitly surfacing to Simon since it's easy to overlook that this coverage is already embedded in GDELT 2.0 rather than being a separate product to newly integrate.

### Gaps
- Did not verify whether Google BigQuery access to the full GDELT dataset has its own usage quotas/costs (BigQuery itself has query-pricing beyond a free tier) — this is a potential hidden cost distinct from GDELT's own "free and open" data license and should be checked against Simon's expected query volume if BigQuery is used instead of direct file downloads.

---

## What satellite/remote-sensing open data sources (fire, earthquake, imagery, nightlights) are useful and what are their access terms?

### Takeaway
NASA FIRMS (active fire detection), USGS Earthquake feeds, Copernicus Sentinel imagery, and NOAA/NASA VIIRS nighttime-lights data are all free, include confirmed or strongly-implied African coverage, and Copernicus explicitly confirms commercial use is allowed for the core Sentinel data (not just "other portal content"); FIRMS has a clear, generous numeric rate limit, while USGS's specific terms-of-use text was not retrieved in this pass.

### Cited Findings
- NASA FIRMS API enforces a limit of 5,000 transactions per 10-minute rolling window, resetting automatically after the window elapses. — [How to use FIRMS API in Python](https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html)
- FIRMS provides both Near Real-Time (NRT) data (including an "Ultra Real Time" tier within minutes of satellite observation for some regions like the US/Canada) and a Standard Processing (SP) dataset with a multi-month lag; African country-level fire-detection queries (e.g., Angola, Zimbabwe) were directly demonstrated as supported via FIRMS's country endpoint. — [How to use FIRMS API in Python](https://firms.modaps.eosdis.nasa.gov/content/academy/data_api/firms_api_use.html)
- Copernicus Sentinel data access is described as "free, full and open," governed by a specific Legal Notice on Copernicus Sentinel Data and Service — distinct from the more restrictive terms that apply only to "other contents of the Copernicus Data Space Ecosystem portal," which are limited to non-commercial use. This implies the core Sentinel satellite data itself (not ancillary portal content) is commercial-use-eligible. — [Copernicus Data Space Ecosystem Terms and Conditions](https://dataspace.copernicus.eu/terms-and-conditions)
- Copernicus imposes volume-based quotas (referenced via a dedicated Quotas documentation page) and explicitly prohibits circumventing them by creating multiple accounts, and prohibits placing unreasonable load on its systems. — [Copernicus Data Space Ecosystem Terms and Conditions](https://dataspace.copernicus.eu/terms-and-conditions)
- ESA has separately confirmed, as an institutional policy matter, that Copernicus Sentinel data access is free and open (ESA Member States approved "full and open Sentinel data policy principles"). — [ESA - Free access to Copernicus Sentinel satellite data](https://www.esa.int/Applications/Observing_the_Earth/Copernicus/Free_access_to_Copernicus_Sentinel_satellite_data); [ESA Member States approve full and open Sentinel data policy principles](https://www.esa.int/Applications/Observing_the_Earth/Copernicus/ESA_Member_States_approve_full_and_open_Sentinel_data_policy_principles)
- USGS publishes a dedicated FDSNWS Event (earthquake catalog) API with full query-parameter documentation, but the fetched page did not contain terms-of-use, rate-limit, or commercial-use text — those are governed elsewhere on the USGS site. — [USGS Earthquake Catalog API Documentation](https://earthquake.usgs.gov/fdsnws/event/1/)
- VIIRS nighttime-lights composite data (relevant as a conflict/displacement/economic-activity proxy) is available as a long-running, freely accessible dataset, including via Google Earth Engine's public data catalog and research-oriented reprocessed series (e.g., a global annual simulated VIIRS dataset spanning 1992–2023, and annual/monthly composite series from NOAA's Earth Observation Group lineage). — [VIIRS Nighttime Day/Night Annual Band Composites V2.2 (Google Earth Engine catalog)](https://developers.google.com/earth-engine/datasets/catalog/NOAA_VIIRS_DNB_ANNUAL_V22); [A global annual simulated VIIRS nighttime light dataset from 1992 to 2023 (Nature Scientific Data)](https://www.nature.com/articles/s41597-024-04228-6); [Annual Time Series of Global VIIRS Nighttime Lights Derived from Monthly Averages: 2012 to 2019 (MDPI Remote Sensing)](https://www.mdpi.com/2072-4292/13/5/922)
- A third-party aggregator (AidData's GeoQuery) also redistributes VIIRS nighttime-lights composites in an analysis-ready form, suggesting an easier ingestion path than raw NOAA/NASA distribution for non-specialist teams. — [VIIRS Nighttime Lights (AidData GeoQuery)](https://www.aiddata.org/geoquery-datasets/viirs-vcmcfg-dnb-composites-v10-yearly-max)

### Inferences
- FIRMS's rate limit (5,000/10 min) is extremely generous relative to FEWS NET/ACLED/UCDP-style structured conflict event APIs, and combined with confirmed Africa-level query granularity, makes it one of the easiest "safe to hammer" sources on this whole list for building a near-real-time fire/burn-event layer (useful as a proxy signal for scorched-earth tactics, displacement-camp fires, or agricultural destruction in conflict zones).
- Because Copernicus explicitly carves commercial use back IN for the core satellite data (only "other portal content" is non-commercial-restricted), this directly answers the brief's "any ACLED-style satellite partnerships" angle in the opposite direction: Copernicus is actually one of the more commercial-friendly sources here, in contrast to ACLED.

### Gaps
- USGS's specific terms-of-use / license text (and any formal rate limit beyond general USGS web-service norms) was not retrieved in this pass; USGS earthquake data is widely known/assumed to be U.S. government public-domain data (and thus free for any use including commercial), but this should be confirmed from USGS's general data policy page rather than assumed, since this pass could not fetch explicit confirming text.
- Did not confirm a specific, documented "ACLED satellite partnership" product in this pass — no evidence either way was found; this specific sub-question from the brief remains unanswered and should be treated as a gap, not a "no."

---

## Summary table (for quick reference by the report writer)

| Source | Commercial use for a for-profit consultancy | Registration required | Update frequency | API / Bulk | Africa depth | Key risk/flag |
|---|---|---|---|---|---|---|
| ACLED | **No — requires separate corporate license**; EULA bars building competing products/services | Yes (myACLED) | Not confirmed in this pass | Both (API + export tool + curated files) | High (core African coverage) | Highest licensing risk on the list; contact ACLED directly before ingesting at volume |
| UCDP | No restriction found; "free of charge," open research infrastructure framing | Appears open (not confirmed) | Not confirmed (GED release cadence vs. candidate events feed) | Both (API w/ 5,000 req/day cap + bulk downloads) | High (GED has coordinates globally incl. Africa) | Confirm formal license text / any non-commercial clause |
| HDX / HAPI | Varies by dataset license; HAPI has its own ToS | Not confirmed | Not confirmed | Both (API/HAPI + bulk dataset downloads) | High (hosts many Africa-specific humanitarian datasets) | Must check license per dataset; direct ToS fetch failed (403) — needs follow-up |
| ACAPS | Not confirmed | Not confirmed | Periodic (named report editions), not clearly real-time | Both (site downloads + api.acaps.org + HDX mirror) | Good (Humanitarian Access Overview, country risk products) | License/ToS text not retrieved — follow-up needed |
| FEWS NET | Not confirmed; attribution expected | Not confirmed | At least daily (per third-party daily mirror project) | API (FDW) + site downloads | Good (IPC-compatible classifications; Ethiopia/Kenya confirmed) | USAID-funded program — verify continuity; ToS/rate limit not confirmed |
| ReliefWeb (OCHA) | Not confirmed | Not confirmed | Real-time | API + docs | Good (UN OCHA global coverage incl. Africa) | ToS/rate limit/commercial terms not retrieved |
| CrisisWatch (Crisis Group) | Not confirmed | N/A (no API found) | Monthly | Neither confirmed (no public API/bulk found) | Good qualitative coverage (70+ conflicts) | No API/bulk license found — likely manual/scrape-risk source only |
| IPC / Cadre Harmonisé | Not confirmed (dedicated ToS doc exists, not fetched) | Not confirmed | Real-time per IPC's own claim | API (incl. CH-IPC joint API) + HDX + FAO catalog | Very high (30+ IPC countries; 45+ CH countries, West Africa/Sahel-focused) | "IPC-CH API Terms of Use" not yet read — follow-up |
| GDELT (GKG, VGKG, GEG, Translingual, etc.) | Yes — "100% free and open," same posture as already-used DOC 2.0/Event products | No new requirement beyond existing GDELT use | 15 minutes (GKG/Event 2.0) | Both (CSV bulk + BigQuery) | Global incl. Africa; Translingual covers francophone/arabophone sources | BigQuery query costs may apply beyond data license itself |
| NASA FIRMS | Not explicitly confirmed, but NASA/EOSDIS data is generally public and government-funded | Likely API key only (not confirmed) | Near-real-time (minutes to hours); SP tier lags months | API + bulk | Confirmed (country-level queries demonstrated for Angola, Zimbabwe, etc.) | License/ToS text not directly retrieved — likely low risk given government-data norms, but unconfirmed |
| USGS Earthquakes | Not explicitly confirmed in this pass (commonly understood as US public-domain data) | No | Real-time feed | API (FDSNWS) + GeoJSON feeds | Global incl. Africa (seismic events) | ToS text not retrieved — treat as low risk pending confirmation |
| Copernicus / Sentinel | **Yes, confirmed** — core Sentinel data is free/full/open; only "other portal content" is non-commercial-restricted | Yes (account for Data Space Ecosystem) | Varies by satellite revisit cycle (not detailed here) | Both (API + bulk download via Data Space Ecosystem) | Global incl. Africa | Volume quotas apply; avoid multi-account workarounds (explicitly prohibited) |
| VIIRS Nighttime Lights | No restriction found (NOAA/NASA-origin data; third-party aggregators redistribute freely) | No | Monthly/annual composites (research-grade reprocessed series found) | Bulk download (NOAA/NASA + Google Earth Engine + AidData GeoQuery) | Global incl. Africa | Not a real-time feed — useful as a slower-moving proxy layer, not an alert source |

### Overall Gaps / Needed Follow-ups
- ACLED: get explicit commercial licensing cost/terms directly from ACLED (web research cannot surface pricing).
- HDX/HAPI, ACAPS, ReliefWeb, FEWS NET, IPC: all have dedicated ToS/terms pages referenced but not fully fetched in this pass (several fetches were blocked or truncated) — a second research pass specifically fetching these five terms-of-use documents in full would close most remaining licensing-certainty gaps.
- No evidence was found, in either direction, of a documented "ACLED satellite partnership" product — unresolved.
- USGS's formal terms-of-use/license text was not retrieved despite USGS data being widely treated as US-government public domain.
