import fs from 'node:fs';
import { TreeGenerator } from '../../src/index.js';

const refDir = '/Users/ws/Library/CloudStorage/OneDrive-Osobisty/reference/design/drzewa/wiaz_Ulmus';
const profile15m = JSON.parse(fs.readFileSync(`${refDir}/wiaz_15m_ulmus.json`, 'utf8'));

// We can inspect by temporarily checking or logging inside TreeGenerator
// Or running a test
console.log('Profile loaded successfully');
