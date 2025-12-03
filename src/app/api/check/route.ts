import { NextResponse } from 'next/server';
import Papa from 'papaparse';
import fs from 'fs';
import path from 'path';

// Define the shape of our data
interface DeviceData {
    "Retail Branding": string;
    "Marketing Name": string;
    "Device": string;
    "Model": string;
}

let cachedData: DeviceData[] | null = null;

export async function GET(request: Request) {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('device');

    if (!query) {
        return NextResponse.json({ error: 'Device parameter is required' }, { status: 400 });
    }

    try {
        let data: DeviceData[] = [];

        if (cachedData) {
            data = cachedData;
        } else {
            console.log("Loading device list from file...");
            const filePath = path.join(process.cwd(), 'data', 'supported_devices.csv');
            const csvText = fs.readFileSync(filePath, 'utf-8');

            // Parse CSV
            const result = Papa.parse<DeviceData>(csvText, {
                header: true,
                skipEmptyLines: true
            });

            data = result.data;
            cachedData = data; // Cache in memory
        }

        // Search logic: Case-insensitive search across relevant fields
        const results = data.filter((item) => {
            const searchStr = query.toLowerCase();
            return (
                (item['Model'] && item['Model'].toLowerCase().includes(searchStr)) ||
                (item['Device'] && item['Device'].toLowerCase().includes(searchStr)) ||
                (item['Marketing Name'] && item['Marketing Name'].toLowerCase().includes(searchStr)) ||
                (item['Retail Branding'] && item['Retail Branding'].toLowerCase().includes(searchStr))
            );
        });

        return NextResponse.json({ results, count: results.length });

    } catch (error) {
        console.error("Error processing request:", error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
