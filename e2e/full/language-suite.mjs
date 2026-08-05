/**
 * Language selector regression suite — all three portals.
 *
 * Run with mandir-web on :5173, devotee-web on :5174 and sant-web on :5175:
 *   PLAYWRIGHT_PATH=../superadmin-web/node_modules/playwright node e2e/full/language-suite.mjs
 *
 * WHY THE HIT-TEST MATTERS
 * The first version of this suite asked "is the option inside the viewport?"
 * using getBoundingClientRect, and passed — while two of the three options were
 * invisible in the real app, painted over by a card that came later in the DOM.
 * A bounding box knows nothing about z-index. Every check below therefore asks
 * document.elementFromPoint() what is actually on top at the option's centre,
 * which is what a user's click hits. Geometry is necessary but not sufficient.
 */
const PW = process.env.PLAYWRIGHT_PATH ?? '../superadmin-web/node_modules/playwright'
const { chromium } = await import(`${PW}/index.mjs`)

const PORTALS = [
  { name: 'mandir-web', url: 'http://localhost:5173/login' },
  { name: 'devotee-web', url: 'http://localhost:5174/login' },
  { name: 'sant-web', url: 'http://localhost:5175/login' },
]

let pass = 0
let fail = 0
const ok = (n) => { pass++; console.log(`  PASS  ${n}`) }
const no = (n, d) => { fail++; console.log(`  FAIL  ${n}\n        ${d}`) }

/** What is actually clickable, not merely well-positioned. */
const probeOptions = (page) => page.evaluate(() => {
  const items = [...document.querySelectorAll('[role="menuitemradio"]')]
  return items.map((el) => {
    const r = el.getBoundingClientRect()
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return {
      text: (el.textContent || '').trim(),
      inViewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
      hittable: !!top && (el === top || el.contains(top)),
      occludedBy: top && !(el === top || el.contains(top))
        ? `${top.tagName.toLowerCase()}.${String(top.className).split(' ').slice(0, 3).join('.')}`
        : null,
    }
  })
})

async function checkSelector(page, label) {
  const btn = page.locator('button[aria-haspopup="menu"]').first()
  if (!(await btn.count())) return no(`${label}: selector present`, 'no button[aria-haspopup="menu"]')
  await btn.click()
  await page.waitForTimeout(350)

  const opts = await probeOptions(page)
  if (opts.length !== 3) return no(`${label}: three languages offered`, `found ${opts.length}`)

  const broken = opts.filter((o) => !o.hittable || !o.inViewport)
  if (broken.length) {
    return no(
      `${label}: every language is clickable`,
      broken.map((b) => `"${b.text}" inViewport=${b.inViewport} hittable=${b.hittable}` +
        (b.occludedBy ? ` occludedBy=<${b.occludedBy}>` : '')).join('\n        '),
    )
  }
  ok(`${label}: three languages, all visible and clickable`)
  await page.keyboard.press('Escape')
}

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true })

for (const portal of PORTALS) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  try {
    await page.goto(portal.url, { waitUntil: 'networkidle' })
    await checkSelector(page, `${portal.name} login`)

    // The selector must survive being mounted near the viewport floor, which is
    // where the sant sidebar puts it — the menu has to flip above the button.
    // left:200 mimics the real sidebar footer: the menu is right-aligned and
    // wider than the pill, so pinning it hard against x=0 would push it off the
    // left edge and report a failure the app does not actually have.
    await page.evaluate(() => {
      const b = document.querySelector('button[aria-haspopup="menu"]')
      const wrap = b.closest('div.relative')
      wrap.style.position = 'fixed'
      wrap.style.bottom = '8px'
      wrap.style.left = '200px'
      wrap.style.top = 'auto'
    })
    await checkSelector(page, `${portal.name} pinned to viewport floor`)
  } catch (e) {
    no(`${portal.name}`, e.message)
  }
  await page.close()
}

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
