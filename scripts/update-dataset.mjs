import fs from 'fs';
import path from 'path';
import https from 'https';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CSV_URL = "https://storage.googleapis.com/play_public/supported_devices.csv";
const DATA_DIR = path.join(__dirname, '..', 'data');
const CSV_PATH = path.join(DATA_DIR, 'supported_devices.csv');
const META_PATH = path.join(DATA_DIR, 'supported_devices.meta.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

function computeSHA256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function loadMetadata() {
    if (fs.existsSync(META_PATH)) {
        return JSON.parse(fs.readFileSync(META_PATH, 'utf-8'));
    }
    if (fs.existsSync(CSV_PATH)) {
        const buffer = fs.readFileSync(CSV_PATH);
        return {
            sha256: computeSHA256(buffer),
            generated_at: new Date().toISOString()
        };
    }
    return {};
}

function saveMetadata(metadata) {
    fs.writeFileSync(META_PATH, JSON.stringify(metadata, null, 2) + '\n', 'utf-8');
}

function fetchHead(url) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, { method: 'HEAD' }, (res) => {
            resolve(res.headers);
        });
        req.on('error', reject);
        req.end();
    });
}

function downloadFile(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode !== 200) {
                reject(new Error(`Failed to download: ${res.statusCode}`));
                return;
            }
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        }).on('error', reject);
    });
}

async function main() {
    const force = process.argv.includes('--force');
    const metadata = loadMetadata();

    console.log('Checking for updates...');

    try {
        const headers = await fetchHead(CSV_URL);
        const etag = headers['etag'];
        const lastModified = headers['last-modified'];

        if (etag && metadata.etag === etag && !force) {
            console.log('Dataset already up-to-date (etag match).');
            process.exit(0);
        }

        console.log('Downloading dataset...');
        const buffer = await downloadFile(CSV_URL);

        // Convert to UTF-8 if necessary
        let content = '';
        if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
            console.log('Detected UTF-16LE encoding, converting to UTF-8...');
            content = buffer.toString('utf16le');
        } else {
            content = buffer.toString('utf8');
        }

        const sha256 = computeSHA256(Buffer.from(content)); // Compute hash on UTF-8 content

        if (metadata.sha256 === sha256 && !force) {
            console.log('Dataset already up-to-date (hash match).');
            // Update metadata headers even if content is same
            metadata.etag = etag;
            metadata.last_modified = lastModified;
            metadata.fetched_at = new Date().toISOString();
            saveMetadata(metadata);
            process.exit(0);
        }

        // Save new data as UTF-8
        fs.writeFileSync(CSV_PATH, content, 'utf-8');

        // Save new metadata
        const newMetadata = {
            source_url: CSV_URL,
            etag: etag,
            last_modified: lastModified,
            sha256: sha256,
            fetched_at: new Date().toISOString(),
            size_bytes: Buffer.byteLength(content, 'utf8')
        };
        saveMetadata(newMetadata);

        console.log(`Dataset updated. New sha256: ${sha256}`);
        process.exit(0);

    } catch (error) {
        console.error('Error updating dataset:', error);
        process.exit(1);
    }
}

main();
