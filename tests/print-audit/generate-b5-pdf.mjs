import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const outputDir = path.resolve(process.argv[2] || 'audit-output');
fs.mkdirSync(outputDir, { recursive: true });

function installedBrowser() {
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.PROGRAMFILES || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        path.join(process.env['PROGRAMFILES(X86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        path.join(process.env.PROGRAMFILES || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      ]
    : [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ];
  return candidates.find(candidate => candidate && fs.existsSync(candidate));
}

const executablePath = installedBrowser();
if (!executablePath) throw new Error('ChromeまたはEdgeが見つかりません。');

const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  const indexPath = path.resolve('index.html');
  await page.goto(pathToFileURL(indexPath).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  // 分類が多く高さ方向の縮小も通る、固定の12枚サンプルをブラウザ内だけに作る。
  // index.htmlや保存データには一切書き込まない。
  await page.evaluate(() => {
    const categories = ['event', 'tea', 'meal', 'season', 'daily', 'other'];
    const colors = ['#f4a6b8', '#88c9d8', '#f2bd72', '#bfa3dc', '#8bc9ae', '#9daab5'];
    const makeImage = (label, color) => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600">`
        + `<rect width="800" height="600" fill="${color}"/>`
        + `<text x="400" y="320" text-anchor="middle" font-family="sans-serif" font-size="72" fill="white">${label}</text>`
        + `</svg>`;
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    };

    state.photos = categories.flatMap((category, categoryIndex) => [0, 1].map(photoIndex => ({
      id: `audit-${category}-${photoIndex}`,
      name: `audit-${category}-${photoIndex}.svg`,
      dataUrl: makeImage(`${categoryIndex + 1}-${photoIndex + 1}`, colors[categoryIndex]),
      category,
      width: 800,
      height: 600,
      sizeOverride: '',
    })));
    state.stickers = [];
    state.layoutMode = 'auto';
    state.comment = 'WindowsとmacOSで同じB5印刷結果を比較するための固定サンプルです。';
    document.getElementById('nl-intro-text').textContent = state.comment;
    renderPhotoList();
    generateLayout();
    document.querySelectorAll('#newsletter img').forEach(image => { image.loading = 'eager'; });
  });

  await page.waitForFunction(() => Array.from(document.images).every(image => image.complete));

  const readFit = () => page.evaluate(() => {
    const result = applyPrintFit();
    const container = document.getElementById('nl-container');
    const wrapper = document.getElementById('nl-wrap');
    const rect = container.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    return {
      ...result,
      cssScale: Number.parseFloat(container.style.getPropertyValue('--print-scale')),
      printWidthPx: Number.parseFloat(wrapper.style.getPropertyValue('--print-w')),
      printHeightPx: Number.parseFloat(wrapper.style.getPropertyValue('--print-h')),
      renderedWidthPx: rect.width,
      wrapperWidthPx: wrapperRect.width,
      fitStyleMedia: document.getElementById('print-fit-style').media,
    };
  });

  await page.emulateMedia({ media: 'print' });
  const fitRuns = [await readFit(), await readFit(), await readFit()];

  const pdfPath = path.join(outputDir, 'b5-print.pdf');
  await page.pdf({
    path: pdfPath,
    printBackground: true,
    displayHeaderFooter: false,
    preferCSSPageSize: true,
    scale: 1,
  });

  const postPdfState = await page.evaluate(() => {
    const container = document.getElementById('nl-container');
    const wrapper = document.getElementById('nl-wrap');
    return {
      cssScale: Number.parseFloat(container.style.getPropertyValue('--print-scale')),
      printWidthPx: Number.parseFloat(wrapper.style.getPropertyValue('--print-w')),
      printHeightPx: Number.parseFloat(wrapper.style.getPropertyValue('--print-h')),
      fitStyleMedia: document.getElementById('print-fit-style').media,
    };
  });

  const browserVersion = browser.version();
  const generation = {
    runner: process.env.RUNNER_OS || os.platform(),
    browserExecutable: executablePath,
    browserVersion,
    pageRule: { widthMm: 182, heightMm: 257, marginMm: 6 },
    fitRuns,
    postPdfState,
    repeatedFitStable: fitRuns.every(run =>
      run.cssScale === fitRuns[0].cssScale
      && run.printWidthPx === fitRuns[0].printWidthPx
      && run.printHeightPx === fitRuns[0].printHeightPx
      && run.compressed === fitRuns[0].compressed)
      && postPdfState.cssScale === fitRuns[0].cssScale
      && postPdfState.printWidthPx === fitRuns[0].printWidthPx
      && postPdfState.printHeightPx === fitRuns[0].printHeightPx,
  };
  fs.writeFileSync(path.join(outputDir, 'generation.json'), `${JSON.stringify(generation, null, 2)}\n`);
} finally {
  await browser.close();
}
