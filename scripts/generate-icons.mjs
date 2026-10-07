// Asset sizing only: the original artwork is kept in resources/icon-foreground.png.
// Requires ImageMagick 7 (magick). Run npm run icons:generate after changing artwork.
import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
const root = fileURLToPath(new URL('../', import.meta.url))
const source = resolve(root, 'resources/icon-foreground.png')
const background = '#1b1b1b'
function render(size, scale, output, transparent = false, round = false) {
  const extent = Math.round(size * scale)
  const args = [source, '-trim', '+repage', '-resize', `${extent}x${extent}`, '-gravity', 'center', '-background', transparent ? 'none' : background, '-extent', `${size}x${size}`]
  if (!transparent) args.push('-alpha', 'remove', '-alpha', 'off')
  if (round) args.push('(', '-size', `${size}x${size}`, 'xc:black', '-fill', 'white', '-draw', `circle ${size / 2},${size / 2} ${size / 2},0`, ')', '-alpha', 'off', '-compose', 'CopyOpacity', '-composite')
  args.push(resolve(root, output))
  const result = spawnSync('magick', args, { encoding: 'utf8' })
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr)
}
mkdirSync(resolve(root, 'public'), { recursive: true })
render(1024, .8, 'resources/icon.png')
render(192, .8, 'public/icon-192x192.png')
render(512, .8, 'public/icon-512x512.png')
// Artwork corners remain inside the central 80%-diameter PWA safe circle.
render(512, .6, 'public/icon-maskable-512x512.png')
render(180, .8, 'public/apple-touch-icon.png')
render(32, .88, 'public/favicon.png')
const densities = { mdpi: [48, 108], hdpi: [72, 162], xhdpi: [96, 216], xxhdpi: [144, 324], xxxhdpi: [192, 432] }
for (const [density, [legacy, adaptive]] of Object.entries(densities)) {
  const dir = `android/app/src/main/res/mipmap-${density}`
  mkdirSync(resolve(root, dir), { recursive: true })
  render(legacy, .78, `${dir}/ic_launcher.png`)
  render(legacy, .78, `${dir}/ic_launcher_round.png`, false, true)
  // 50dp artwork in a 108dp canvas keeps the entire radio within the 66dp safe circle.
  render(adaptive, .46, `${dir}/ic_launcher_foreground.png`, true)
}
writeFileSync(resolve(root, 'android/app/src/main/res/values/ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${background}</color>\n</resources>\n`)
console.log('Generated Android launcher icons in five densities, adaptive foregrounds, PWA icons and browser icons.')
