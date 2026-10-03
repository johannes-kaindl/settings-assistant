# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Bekannt

- Die Schnappschuss-Liste (Kit-`version-list`) setzt `aria-pressed="false"` auf Aktionsknöpfe, obwohl sie semantisch ein Toggle ist; Kit-Task angelegt (Modus select/action), bis dahin bleibt es so.
- Ein lokaler Fallback-Endpunkt (ohne Endpoint Manager) speichert den API-Schlüssel im Klartext in der eigenen data.json; mit dem Endpoint Manager liegt der Schlüssel im Schlüsselbund.
- Zahlenschlüssel wie `"10"` sortiert JavaScript in Objekten nach vorn (Profil-Einsetzen).
