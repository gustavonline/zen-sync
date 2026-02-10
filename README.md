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

1.  Create a new folder where you want to store your profile data:
    ```bash
    mkdir my-zen-profile
    cd my-zen-profile
    ```
2.  Run the setup wizard:
    ```bash
    zensync setup
    ```
3.  Choose one of the options:
    - **Clone existing repository:** If you already have a ZenSync repo on another machine.
    - **Create new repository:** If this is your first time setting up ZenSync. It will import your current browser data and create a private GitHub repo for you.

4.  Start syncing:
    ```bash
    zensync watch
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
