import { writeFileSync } from 'node:fs';
const response = await fetch('http://127.0.0.1:4185/__qa/health');
if (!response.ok) throw new Error('Cannot preserve current QA process state');
const state = await response.json();
if (state.activeRequests) throw new Error('QA request is active; wait before restarting');
const snapshot = { capturedAt: new Date().toISOString(), reason: 'Enable exact production workspace layer virtual module; previous exec session 89631', state };
writeFileSync(new URL('./qa-before-nested-restart.json', import.meta.url), JSON.stringify(snapshot, null, 2) + '\n');
console.log(JSON.stringify({ saved: 'qa-before-nested-restart.json', counts: state.counts, submissions: state.submissions.length, requests: state.requests.length }));
