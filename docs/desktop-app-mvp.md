# ZenSync Desktop App (Ultra Minimal MVP)

## Formål
Byg en **meget simpel desktop app** der erstatter den nuværende CLI-workflow for almindelige brugere.

Appen skal:
- starte/styre sync
- vise status
- vise logs
- håndtere opdateringer
- have en "Fix errors"-knap til typiske git-problemer

---

## Tech-valg
**Anbefaling: Tauri (Rust + web UI)**

Hvorfor:
- Letvægts footprint ift. Electron
- God cross-platform støtte (macOS + Windows)
- Nem system tray/minimize-to-tray
- God model til auto-updates

UI kan være helt enkel (fx Svelte/React/Vite), men kun med få skærme.

---

## MVP scope

### 1) Dashboard (single view)
- Sync status: `Running / Stopped`
- Sidste sync tidspunkt
- Repo path
- Knapper:
  - `Start`
  - `Stop`
  - `Sync now`
  - `Open logs`
  - `Fix errors`

### 2) Opdateringer
- App checker ved opstart om ny version findes
- Vis non-blocking banner: `Ny version tilgængelig`
- Knap: `Opdater nu`
- App downloader + genstarter

### 3) Logs
- Viser seneste linjer fra ZenSync logfil
- Filter: `All / Warnings / Errors`
- Knap: `Copy`

### 4) Fix errors (første version)
Kører samme recovery-idé som CLI allerede bruger:
- rydder stale rebase/lock metadata
- håndterer unmerged conflict state
- håndterer untracked-overwrite konflikter
- laver recovery-backup mappe før indgreb

Output vises i UI som kort resultat:
- `Fixed`
- `Could not fix` + kort årsag

### 5) Tray behavior
- Luk vindue => app fortsætter i tray
- Tray menu:
  - Open ZenSync
  - Sync now
  - Start/Stop watcher
  - Quit

---

## Ikke i MVP
- Avanceret settings-side
- Multi-profile support
- In-app git visual diff
- Telemetri

---

## Implementeringsplan (kort)
1. Opret `apps/desktop` (Tauri projekt)
2. Pak nuværende Node sync-kerne som intern service/kommandoer
3. Eksponér få kommandoer til UI:
   - `getStatus`
   - `startWatcher`
   - `stopWatcher`
   - `syncNow`
   - `readLogs`
   - `fixCommonErrors`
   - `checkForUpdates`
4. Tilføj tray + autostart + updater
5. Ship intern alpha på macOS, derefter Windows

---

## Definition of done (MVP)
- En bruger kan installere appen, klikke "Start", og få stabil sync uden terminal
- En bruger får besked om opdatering i appen og kan opdatere med 1 klik
- En bruger kan se logs og trykke "Fix errors" ved almindelige git-konflikter
- Appen fungerer på både macOS og Windows og kan køre i tray
