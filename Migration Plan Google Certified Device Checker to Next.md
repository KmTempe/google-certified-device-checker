# Migration Plan: Google Certified Device Checker to Next.js

This plan outlines the steps to transform `google-certified-device-checker` into a unified Next.js application, mirroring the architecture of `bin-checker`.

## Goal
Migrate the existing split architecture (Python Backend on Render + Static Frontend on GitHub Pages) to a single **Next.js** application deployed on **Vercel**.

## Current vs. Target Architecture

| Feature | Current Architecture | Target Architecture (Next.js) |
| :--- | :--- | :--- |
| **Frontend** | Static HTML/JS (GitHub Pages) | React Server/Client Components (`src/app`) |
| **Backend** | Python (Render) | Next.js API Routes (`src/app/api`) |
| **Database** | Device List (File/Memory) | Device List (File/Memory) |
| **Deployment** | Multi-platform (Render + GH Pages) | Single-platform (Vercel) |

## Implementation Steps

### 1. Project Initialization
Create a new Next.js project to serve as the foundation.
- Initialize with `npx create-next-app@latest`.
- Configure **Tailwind CSS** (v4) to match `bin-checker`.
- Install dependencies: `papaparse` (if data is CSV), `@vercel/analytics`.

### 2. Backend Migration (Python -> Next.js API)
Rewrite the Python `main.py` logic into a Next.js API Route.

**Source:** `app/main.py` (Python)
**Target:** `src/app/api/check/route.js` (Node.js)

- **Data Loading**:
  - If the device list is a CSV/JSON file, place it in `src/data/` or fetch it from a remote URL (like `bin-checker` does).
  - Use `papaparse` or `JSON.parse` to load data into memory.
  - Implement caching: Use a global variable (like `let cachedData = null`) to store parsed data across requests in the serverless container.

- **Search Logic**:
  - Reimplement the search algorithm (likely a simple list filter/find) in JavaScript.
  - Example: `data.find(device => device.model === searchModel)`

- **Rate Limiting (Optional but Recommended)**:
  - Use **Vercel Middleware** or `@upstash/ratelimit` to protect the API, replacing the Python token bucket implementation.

### 3. Frontend Migration
Port the static frontend to Next.js React Components.

- **Layout**: Create `src/app/layout.js` with global styles and metadata.
- **Page**: Create `src/app/page.js` for the main UI.
  - Port the search form and results display.
  - Use `useState` for managing search input and results.
  - Replace direct API calls with calls to `/api/check`.
- **Styling**: Convert existing CSS to Tailwind classes or import global CSS files.

### 4. Deployment
- Push the new Next.js repository to GitHub.
- Import the project into **Vercel**.
- Configure Environment Variables (if any).
- Deploy!

## Benefits
- **Unified Codebase**: Frontend and Backend in one repo (Monorepo).
- **Performance**: Vercel Edge Network and Serverless functions.
- **Cost**: Likely free (Hobby tier) vs Render (potentially paid/sleeping instances).
- **Simplicity**: No need to manage Python runtime or separate deployments.

## Example API Route (`src/app/api/check/route.js`)
```javascript
import { NextResponse } from 'next/server';
import Papa from 'papaparse';

const DATA_URL = "https://raw.githubusercontent.com/.../device-list.csv";
let cachedData = null;

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('device');

    if (!cachedData) {
        // Fetch and parse data
        const res = await fetch(DATA_URL);
        const text = await res.text();
        // Parse logic here...
        cachedData = parsedData;
    }

    // Search logic
    const result = cachedData.find(d => d.name.includes(query));
    return NextResponse.json(result || { error: 'Not found' });
}
```

---

# Migration Resources

This document contains the code snippets you need to create the new **Google Certified Device Checker** Next.js application.

## 1. API Route (`src/app/api/check/route.js`)

This file handles fetching the device list (from a remote CSV or local file) and searching through it.

```javascript
import { NextResponse } from 'next/server';
import Papa from 'papaparse';

// URL to the raw CSV file containing the device list.
// REPLACE THIS with the actual URL of your device list CSV.
const DEVICE_LIST_URL = "https://raw.githubusercontent.com/KmTempe/google-certified-device-checker/main/device-list.csv";

let cachedData = null;

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('device');

    if (!query) {
        return NextResponse.json({ error: 'Device parameter is required' }, { status: 400 });
    }

    try {
        let data = [];
        
        if (cachedData) {
            data = cachedData;
        } else {
            console.log("Fetching device list...");
            const response = await fetch(DEVICE_LIST_URL);
            if (!response.ok) {
                throw new Error('Failed to fetch device list');
            }
            const csvText = await response.text();
            
            // Parse CSV
            const result = Papa.parse(csvText, { 
                header: true, 
                skipEmptyLines: true 
            });
            
            data = result.data;
            cachedData = data; // Cache in memory
        }

        // Search logic: Case-insensitive search across relevant fields
        // Adjust 'Model', 'Device', 'Marketing Name' based on your actual CSV headers
        const results = data.filter((item) => {
            const searchStr = query.toLowerCase();
            return (
                (item['Model'] && item['Model'].toLowerCase().includes(searchStr)) ||
                (item['Device'] && item['Device'].toLowerCase().includes(searchStr)) ||
                (item['Marketing Name'] && item['Marketing Name'].toLowerCase().includes(searchStr))
            );
        });

        return NextResponse.json({ results, count: results.length });

    } catch (error) {
        console.error("Error processing request:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
```

## 2. Frontend Page (`src/app/page.js`)

This is the main UI, adapted from `bin-checker` but tailored for device searching.

```javascript
"use client";

import { useState, useEffect } from "react";
import "./styles/global.css";

export default function Home() {
  const [searchTerm, setSearchTerm] = useState("");
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true); // Default to dark

  // Theme handling (simplified from bin-checker)
  useEffect(() => {
    const savedTheme = localStorage.getItem("theme");
    if (savedTheme === "light") {
        setIsDarkMode(false);
        document.getElementById("theme-style").href = "/styles/light-globals.css";
    }
  }, []);

  const toggleTheme = () => {
    const themeLink = document.getElementById("theme-style");
    if (isDarkMode) {
      themeLink.href = "/styles/light-globals.css";
      localStorage.setItem("theme", "light");
    } else {
      themeLink.href = "/styles/dark-globals.css";
      localStorage.setItem("theme", "dark");
    }
    setIsDarkMode(!isDarkMode);
  };

  async function handleSearch() {
    if (!searchTerm) return;

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const res = await fetch(`/api/check?device=${encodeURIComponent(searchTerm)}`);
      const data = await res.json();

      if (data.error) {
        setError(data.error);
      } else {
        setResults(data.results);
      }
    } catch (err) {
      setError("Failed to fetch device data.");
    } finally {
        setLoading(false);
    }
  }

  return (
    <div className="container">
      <nav className="nav-menu">
        <button onClick={toggleTheme}>
          Switch to {isDarkMode ? "Light" : "Dark"} Mode
        </button>
      </nav>

      <h1>Google Certified Device Checker</h1>

      <div className="input-container">
        <input
          type="text"
          placeholder="Enter Device Name or Model"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <button onClick={handleSearch}>Search</button>
      </div>

      {loading && <p className="loading-text">Searching...</p>}
      {error && <p className="error">{error}</p>}

      {results && (
        <div className="results">
            <p>Found {results.length} device(s)</p>
            {results.map((device, index) => (
                <div key={index} style={{ marginBottom: '20px', borderBottom: '1px solid var(--border-color)' }}>
                    <p><span>Marketing Name:</span> <span>{device['Marketing Name']}</span></p>
                    <p><span>Device:</span> <span>{device['Device']}</span></p>
                    <p><span>Model:</span> <span>{device['Model']}</span></p>
                </div>
            ))}
            {results.length === 0 && <p>No devices found.</p>}
        </div>
      )}
    </div>
  );
}
```

## 3. Styles

Copy `src/app/styles/global.css` and `public/styles/dark-globals.css` (and light version) from `bin-checker` to your new project. They are generic enough to work out of the box.

## 4. Dependencies

Run this in your new project:
```bash
npm install papaparse
```
