import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import generateBMFont from 'msdf-bmfont-xml'
import { genFont, setGeneratePaths } from '../dist/genFont.js'

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')
const FONT_FILE = 'Lato-Regular.ttf'
const FONT_PATH = path.join(FIXTURES, FONT_FILE)
const LARGE_CHARSET_PATH = path.join(FIXTURES, 'charset.large.json')
const SMALL_CHARSET_PATH = path.join(FIXTURES, 'charset.small.json')

// fontSize 42 + ~616 chars exceeds a single 512x512 pot atlas, forcing >= 2 pages
const LARGE_CHARSET = JSON.parse(fs.readFileSync(LARGE_CHARSET_PATH, 'utf8')).charset
const MULTI_PAGE_OPTIONS = {
  fieldType: 'msdf',
  outputType: 'json',
  roundDecimal: 6,
  smartSize: true,
  pot: true,
  fontSize: 42,
  distanceRange: 4,
  charset: LARGE_CHARSET,
}

function makeTempDir(id) {
  const dir = path.join(os.tmpdir(), `msdf-test-${id}-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Pre-condition: the fixture font + large charset produces >= 2 textures from msdf-bmfont-xml
// directly. If this fails, the charset/fontSize combo needs adjusting.
test('large charset produces multiple texture pages from msdf-bmfont-xml', async () => {
  await new Promise((resolve, reject) => {
    generateBMFont(FONT_PATH, MULTI_PAGE_OPTIONS, (err, textures) => {
      if (err) return reject(err)
      assert.ok(
        textures.length >= 2,
        `Expected >= 2 textures but got ${textures.length}. Increase fontSize or charset size.`
      )
      resolve()
    })
  })
})

// Confirms the fix: genFont writes one PNG per page, filenames match the JSON pages array.
// Forces multi-page output by overriding textureSize to 256x256 (too small for the large charset).
test('genFont fix: all page PNGs are written and match JSON pages array', async () => {
  const srcDir = makeTempDir('src')
  const outDir = makeTempDir('fix')
  try {
    fs.copyFileSync(FONT_PATH, path.join(srcDir, FONT_FILE))
    const charsetPath = path.join(srcDir, 'charset.large.json')
    fs.writeFileSync(charsetPath, fs.readFileSync(LARGE_CHARSET_PATH))
    fs.writeFileSync(path.join(srcDir, 'overrides.json'), JSON.stringify({
      'Lato-Regular': { msdf: { textureWidth: 256, textureHeight: 256 } }
    }))

    setGeneratePaths(srcDir, outDir, charsetPath)
    await genFont(FONT_FILE, 'msdf')

    const jsonPath = path.join(outDir, 'Lato-Regular.msdf.json')
    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))

    assert.ok(
      json.pages.length >= 2,
      `Expected JSON to list >= 2 pages but got ${json.pages.length}`
    )

    const pngFiles = fs.readdirSync(outDir).filter(f => f.endsWith('.png'))
    assert.strictEqual(
      pngFiles.length,
      json.pages.length,
      `Expected ${json.pages.length} PNGs on disk (one per page) but got ${pngFiles.length}`
    )

    // Page 0 must use the unindexed name so atlasUrl always resolves
    assert.strictEqual(
      json.pages[0],
      'Lato-Regular.msdf.png',
      'Page 0 must use the unindexed filename so atlasUrl works in the renderer'
    )

    // Additional pages must use indexed names (_1, _2, ...)
    for (let i = 1; i < json.pages.length; i++) {
      assert.strictEqual(
        json.pages[i],
        `Lato-Regular.msdf_${i}.png`,
        `Page ${i} must use the _${i} suffix`
      )
    }

    // Every filename in json.pages must exist on disk
    for (const page of json.pages) {
      assert.ok(
        fs.existsSync(path.join(outDir, page)),
        `JSON references page "${page}" but file does not exist on disk`
      )
    }
  } finally {
    fs.rmSync(srcDir, { recursive: true, force: true })
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// Same coverage as the previous test, kept as a separate named case in the regression harness.
test('all page PNGs exist and json.pages filenames match files on disk', async () => {
  const srcDir = makeTempDir('src2')
  const outDir = makeTempDir('pages-match')
  try {
    fs.copyFileSync(FONT_PATH, path.join(srcDir, FONT_FILE))
    const charsetPath = path.join(srcDir, 'charset.large.json')
    fs.writeFileSync(charsetPath, fs.readFileSync(LARGE_CHARSET_PATH))
    fs.writeFileSync(path.join(srcDir, 'overrides.json'), JSON.stringify({
      'Lato-Regular': { msdf: { textureWidth: 256, textureHeight: 256 } }
    }))

    setGeneratePaths(srcDir, outDir, charsetPath)
    await genFont(FONT_FILE, 'msdf')

    const json = JSON.parse(fs.readFileSync(path.join(outDir, 'Lato-Regular.msdf.json'), 'utf8'))
    const pngCount = fs.readdirSync(outDir).filter(f => f.endsWith('.png')).length

    assert.strictEqual(pngCount, json.pages.length)
  } finally {
    fs.rmSync(srcDir, { recursive: true, force: true })
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// Regression: a small charset that fits on one page should still produce exactly
// 1 PNG and json.pages.length === 1 after genFont + adjustFont.
test('single-page charset produces 1 PNG with correct JSON structure', async () => {
  const { adjustFont } = await import('../dist/adjustFont.js')
  const outDir = makeTempDir('single')
  try {
    setGeneratePaths(FIXTURES, outDir, SMALL_CHARSET_PATH)
    const fontInfo = await genFont(FONT_FILE, 'msdf')
    assert.ok(fontInfo, 'genFont should return font info for a valid font')
    await adjustFont(fontInfo)

    const json = JSON.parse(fs.readFileSync(fontInfo.jsonPath, 'utf8'))

    assert.strictEqual(json.pages.length, 1, `Expected 1 page in JSON, got ${json.pages.length}`)

    const pngCount = fs.readdirSync(outDir).filter(f => f.endsWith('.png')).length
    assert.strictEqual(pngCount, 1, `Expected 1 PNG on disk, got ${pngCount}`)

    assert.ok('lightningMetrics' in json, 'lightningMetrics should be present after adjustFont')
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})
