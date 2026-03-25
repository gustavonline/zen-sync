# ZenSync

Seamlessly sync your Zen Browser profile between macOS and Windows using GitHub.

## Features
- **Cross-Platform:** Syncs your profile between macOS and Windows.
- **Separate Data:** Keeps your sensitive profile data in a private repository, separate from the CLI tool.
- **Easy Setup:** Interactive wizard to clone an existing profile or create a new one from your current browser data.
- **Automatic Sync:** Runs in the background to keep devices in sync.

## Installation

```bash
npm install -g zensync
```

## Quick Start

1.  **Install & Setup:**
    ```bash
    npm install -g zensync
    zensync setup
    ```
2.  **Follow the Wizard:**
    - The wizard will ask where to store your profile data (e.g., `~/zensync-data`).
    - If you are on a **new machine**, choose **"Clone existing repository"** and provide your GitHub URL.
    - If this is your **first time**, choose **"Create a new repository"**. It will import your browser data and create a private GitHub repo for you.

3.  **Start Syncing:**
    ```bash
    zensync watch
    ```

## Branch Naming

ZenSync uses `main` as the default branch for profile repositories.

If you have an older profile repo that still uses `master`, rename it:

```bash
git branch -m master main
git push -u origin main
```

## Development

If you want to contribute to ZenSync or develop features:

1.  Clone this repository:
    ```bash
    git clone https://github.com/gustavonline/zen-sync.git
    cd zen-sync
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Link the package globally:
    ```bash
    npm link
    ```
    This makes the `zensync` command point to your local source code.

4.  Test with a separate profile repository (e.g., `../zen-profile-data`) by running `zensync` commands there.

## Setup Guides

- macOS setup (new machine): [`docs/mac-setup.md`](docs/mac-setup.md)
