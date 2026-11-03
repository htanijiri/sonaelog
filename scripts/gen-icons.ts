// アプリのアイコン（PNG）を public/icons/icon.svg から作る。アイコンを変えたときだけ実行する。
// 使い方：npx tsx scripts/gen-icons.ts
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const svg = readFileSync('public/icons/icon.svg', 'utf8')
const targets = [
  { file: 'public/icons/icon-192.png', size: 192, pad: 0 },
  { file: 'public/icons/icon-512.png', size: 512, pad: 0 },
  // maskable は端末が四隅を切り抜くので、余白を取って中央に置く
  { file: 'public/icons/icon-maskable-512.png', size: 512, pad: 0.1 },
  { file: 'public/icons/apple-touch-icon.png', size: 180, pad: 0 },
]

const browser = await chromium.launch()
const page = await browser.newPage()
for (const t of targets) {
  const inner = Math.round(t.size * (1 - t.pad * 2))
  await page.setViewportSize({ width: t.size, height: t.size })
  await page.setContent(
    `<html><body style="margin:0;background:#1f4e5f;display:grid;place-items:center;width:${t.size}px;height:${t.size}px">` +
      `<div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  )
  await page.screenshot({ path: t.file })
  console.log('作成:', t.file)
}
await browser.close()
