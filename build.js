#!/usr/bin/env node
// usage: node build.js
// 報告する人向けのビルドを dist/ に作る: 公開ビルド（このファイルの隣の .user.js そのもの）に、
// private/report.json のフォームの URL と entry.ID を埋め、名前に (reporter) を付ける。
// private/report.json: { "url": "https://docs.google.com/forms/d/e/.../formResponse", "fields": { "user": "entry.…", … } }
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, 'trickcal-guard.user.js');
const CFG = path.join(__dirname, 'private', 'report.json');
const OUT = path.join(__dirname, 'dist', 'trickcal-onecushion.reporter.user.js');
if (!fs.existsSync(CFG)) { console.error('no private/report.json'); process.exit(1); }
const { url, fields } = JSON.parse(fs.readFileSync(CFG, 'utf8'));
let s = fs.readFileSync(SRC, 'utf8');
const rep = (a, b) => { if (s.split(a).length !== 2) throw new Error('anchor: ' + a); s = s.replace(a, () => b); };
rep("const FORM_URL = '';", `const FORM_URL = ${JSON.stringify(url)};`);
rep('const FORM_FIELDS = {};', `const FORM_FIELDS = ${JSON.stringify(fields)};`);
s = s.replace(/^(\/\/ @name(?::\w+)?\s+)(.*)$/gm, (_, k, v) => `${k}${v} (reporter)`);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, s);
console.log('wrote', path.relative(__dirname, OUT), s.length, 'bytes');
