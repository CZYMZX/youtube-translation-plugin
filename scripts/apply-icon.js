import fs from 'fs';
import path from 'path';

const choiceNum = process.argv[2] || '1';
const svgFile = path.resolve(`public/icon-choice-${choiceNum}.svg`);

if (!fs.existsSync(svgFile)) {
  console.error(`Error: ${svgFile} 不存在！请指定 1 到 6 之间的数字。`);
  process.exit(1);
}

console.log(`正在应用图标方案 #${choiceNum}...`);

// 寻找本机 Chrome / Edge 可执行文件
function getBrowserPath() {
  const possiblePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const browserPath = getBrowserPath();

// 复制一份作为主 icon.svg
fs.copyFileSync(svgFile, path.resolve('public/icon.svg'));

if (browserPath) {
  try {
    const puppeteer = await import('puppeteer-core');
    const browser = await puppeteer.default.launch({
      executablePath: browserPath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    const svgContent = fs.readFileSync(svgFile, 'utf-8');

    for (const size of [16, 48, 128]) {
      const html = `<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; }
    body { width: ${size}px; height: ${size}px; overflow: hidden; background: transparent; }
    svg { width: 100%; height: 100%; display: block; }
  </style>
</head>
<body>
  ${svgContent}
</body>
</html>`;

      await page.setViewport({ width: size, height: size, deviceScaleFactor: 2 }); // 2x 超采样防锯齿
      await page.setContent(html, { waitUntil: 'domcontentloaded' });
      const outPath = path.resolve(`public/icon-${size}.png`);
      await page.screenshot({ path: outPath, omitBackground: true });
      console.log(`✅ 已生成: public/icon-${size}.png (${size}x${size})`);
    }

    await browser.close();
    console.log(`🎉 方案 #${choiceNum} 图标已成功应用到当前扩展！`);
  } catch (err) {
    console.warn('浏览器生成 PNG 失败，已更新 public/icon.svg:', err.message);
  }
} else {
  console.log('未找到本地 Chrome/Edge 浏览器，已更新 public/icon.svg');
}
