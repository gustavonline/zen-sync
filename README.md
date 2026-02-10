# ZenSync

Seamlessly sync your Zen Browser profile between macOS and Windows using GitHub.

## Features
- Syncs your Zen Browser profile across devices.
- Works on macOS and Windows.
- Uses a separate Git repository for your profile data.

## Installation

```bash
npm install -g zensync
```

## Usage

1.  Create a directory for your profile data (or clone your existing profile repo).
2.  Navigate to that directory.
3.  Run `zensync setup`. This will configure the current directory as your profile repository and link your Zen Browser profile to it.
4.  Run `zensync watch` to start syncing changes automatically.

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
