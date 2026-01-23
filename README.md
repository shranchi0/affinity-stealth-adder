# Affinity Stealth Adder

Chrome extension to quickly add companies and stealth founders to Affinity CRM.

## What it does

**On any company website** (e.g. `xyz.com`), click the button to:
- Create an organization with the company name and domain
- Add it to your Master Deal List
- Automatically assign you as the owner

**On a LinkedIn profile** of someone at a stealth startup, click the button to:
- Create an organization named `Stealth_FirstName LastName`
- Create/link the person to that organization
- Add it to your Master Deal List
- Automatically assign you as the owner

## Installation

1. Download this repo (click **Code** → **Download ZIP**) and unzip it
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the folder you unzipped

## Setup

1. Click the extension icon in your Chrome toolbar
2. Enter your **Affinity API Key** (found in Affinity → Settings → API)
3. Enter the **List ID**: `299100`
4. Enter your **Affinity Subdomain**: `categoryventures`
5. Click Save

## Usage

1. Go to any website or LinkedIn profile
2. Click the purple **Add to Affinity** button (or press `Cmd+Shift+A`)
3. Add an optional note in the modal that appears
4. Click "Add to Affinity"
5. Click the "Open" link in the success toast to view in Affinity

## Features

- **Keyboard shortcut**: `Cmd+Shift+A` (Mac) or `Ctrl+Shift+A` (Windows)
- **Quick notes**: Add a note when adding (e.g., "Met at demo day")
- **Duplicate detection**: Warns if the company already exists in Affinity
- **Direct link**: Success toast includes a link to open the entry in Affinity

## Team Members

Each person needs their own Affinity API key. The List ID is shared.
