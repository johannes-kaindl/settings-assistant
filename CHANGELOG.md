# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Bekannt

- Die Schnappschuss-Liste (Kit-`version-list`) setzt `aria-pressed="false"` auf Aktionsknöpfe, obwohl sie semantisch ein Toggle ist; Kit-Task angelegt (Modus select/action), bis dahin bleibt es so.
- API-Schlüssel liegen im Schlüsselbund, auch in der lokalen Endpunkt-Liste ohne Endpoint Manager; vorhandene Klartext-Schlüssel werden beim ersten Start migriert und aus der data.json entfernt. Das Plugin verlangt dafür Obsidian 1.11.4 oder neuer; wo der Schlüsselbund fehlt, bliebe der Klartext bis zur Migration stehen.
- Zahlenschlüssel wie `"10"` sortiert JavaScript in Objekten nach vorn (Profil-Einsetzen).
