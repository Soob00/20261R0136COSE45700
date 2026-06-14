import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';

function parseArgs(argv) {
  const parsed = {
    spec: '',
    url: 'http://localhost:3000',
    timeout: 30000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--spec') {
      parsed.spec = argv[i + 1] ?? '';
      i += 1;
    } else if (arg === '--url') {
      parsed.url = argv[i + 1] ?? parsed.url;
      i += 1;
    } else if (arg === '--timeout') {
      parsed.timeout = Number(argv[i + 1] ?? parsed.timeout);
      i += 1;
    }
  }
  return parsed;
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.spec) {
    throw new Error('missing --spec');
  }

  const specPath = path.resolve(process.cwd(), args.spec);
  const rawSpec = await fs.readFile(specPath, 'utf-8');
  const spec = JSON.parse(rawSpec);
  const previewDir = path.dirname(specPath);
  const screenshotPath = path.join(previewDir, 'acc_001_attach_preview_3d.png');
  const resultPath = path.join(previewDir, 'render_result.json');
  const logs = [];
  const routeUrl = `${args.url.replace(/\/$/, '')}/dev/accessory-render?spec=${encodeURIComponent(args.spec)}`;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: {
        width: Number(spec.renderWidth ?? 1024),
        height: Number(spec.renderHeight ?? 1024),
      },
    });
    const page = await context.newPage();

    page.on('console', (msg) => {
      logs.push(`[console:${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
      logs.push(`[pageerror] ${err.message}`);
    });

    await page.goto(routeUrl, {
      waitUntil: 'networkidle',
      timeout: args.timeout,
    });

    await page.waitForFunction(
      () => Boolean(window.__ACCESSORY_RENDER_RESULT__ && window.__ACCESSORY_RENDER_RESULT__.stage !== 'loading'),
      { timeout: args.timeout },
    );

    const renderResult = await page.evaluate(() => window.__ACCESSORY_RENDER_RESULT__);
    const canvas = page.locator('canvas').first();
    if (await canvas.count()) {
      await fs.mkdir(path.dirname(screenshotPath), { recursive: true });
      await canvas.screenshot({ path: screenshotPath });
    }

    const output = {
      ...renderResult,
      stage: renderResult?.stage ?? 'failed',
      specPath: args.spec,
      logs,
    };
    await writeJson(resultPath, output);
    await browser.close();
    process.exit(output.ok ? 0 : 1);
  } catch (error) {
    const output = {
      ok: false,
      stage: 'failed',
      specPath: args.spec,
      inFrame: false,
      projectedBBox: null,
      projectedAreaRatio: null,
      anchorBoneRequested: null,
      anchorBoneResolved: null,
      warnings: [],
      error: error instanceof Error ? error.message : 'render_failed',
      logs,
    };
    await writeJson(resultPath, output);
    if (browser) {
      await browser.close();
    }
    process.exit(1);
  }
}

await main();
