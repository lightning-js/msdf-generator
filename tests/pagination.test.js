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

const LARGE_CHARSET = JSON.parse(fs.readFileSync(LARGE_CHARSET_PATH, 'utf8')).charset
const SMALL_CHARSET = JSON.parse(fs.readFileSync(SMALL_CHARSET_PATH, 'utf8')).charset

// Reads width/height from a PNG IHDR chunk.
function pngSize(filePath) {
  const buf = fs.readFileSync(filePath)
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function makeTempDir(id) {
  const dir = path.join(os.tmpdir(), `msdf-test-${id}-${Date.now()}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

// Pre-condition: the fixture font + large charset produces >= 2 textures from msdf-bmfont-xml
// directly. If this fails, the charset/fontSize combo in the fixture needs adjusting.
test('large charset produces multiple texture pages from msdf-bmfont-xml', async () => {
  await new Promise((resolve, reject) => {
    generateBMFont(FONT_PATH, {
      fieldType: 'msdf',
      outputType: 'json',
      roundDecimal: 6,
      smartSize: true,
      pot: true,
      fontSize: 42,
      distanceRange: 4,
      charset: LARGE_CHARSET,
    }, (err, textures) => {
      if (err) return reject(err)
      assert.ok(
        textures.length >= 2,
        `Expected >= 2 textures but got ${textures.length}. Increase fontSize or charset size in fixture.`
      )
      resolve()
    })
  })
})

// Confirms the multi-page fix: genFont writes one PNG per page, filenames and json.pages match.
// Forces multipage by setting textureSize: 256 in overrides (too small for the large charset).
test('genFont: all page PNGs are written and json.pages matches disk', async () => {
  const srcDir = makeTempDir('src')
  const outDir = makeTempDir('multipage')
  try {
    fs.copyFileSync(FONT_PATH, path.join(srcDir, FONT_FILE))
    const charsetPath = path.join(srcDir, 'charset.large.json')
    fs.copyFileSync(LARGE_CHARSET_PATH, charsetPath)
    fs.writeFileSync(path.join(srcDir, 'overrides.json'), JSON.stringify({
      'Lato-Regular': { msdf: { textureSize: 256 } }
    }))

    setGeneratePaths(srcDir, outDir, charsetPath)
    await genFont(FONT_FILE, 'msdf')

    const json = JSON.parse(fs.readFileSync(path.join(outDir, 'Lato-Regular.msdf.json'), 'utf8'))

    assert.ok(json.pages.length >= 2, `Expected >= 2 pages in JSON but got ${json.pages.length}`)

    const pngFiles = fs.readdirSync(outDir).filter(f => f.endsWith('.png'))
    assert.strictEqual(pngFiles.length, json.pages.length,
      `Expected ${json.pages.length} PNGs on disk but found ${pngFiles.length}`)

    // Page 0 must use the unindexed name so atlasUrl resolves without a suffix
    assert.strictEqual(json.pages[0], 'Lato-Regular.msdf.png',
      'Page 0 must use the unindexed filename')

    // Pages 1+ must use _N suffixes
    for (let i = 1; i < json.pages.length; i++) {
      assert.strictEqual(json.pages[i], `Lato-Regular.msdf_${i}.png`,
        `Page ${i} must use the _${i} suffix`)
    }

    // Every filename in json.pages must exist on disk
    for (const page of json.pages) {
      assert.ok(fs.existsSync(path.join(outDir, page)),
        `PNG file listed in pages[] not found on disk: ${page}`)
    }
  } finally {
    fs.rmSync(srcDir, { recursive: true, force: true })
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// Regression: a small charset on the default atlas must produce exactly 1 unindexed PNG.
test('genFont: single-page output has no _0 suffix (regression)', async () => {
  const srcDir = makeTempDir('src')
  const outDir = makeTempDir('singlepage')
  try {
    fs.copyFileSync(FONT_PATH, path.join(srcDir, FONT_FILE))
    const charsetPath = path.join(srcDir, 'charset.small.json')
    fs.copyFileSync(SMALL_CHARSET_PATH, charsetPath)

    setGeneratePaths(srcDir, outDir, charsetPath)
    await genFont(FONT_FILE, 'msdf')

    const json = JSON.parse(fs.readFileSync(path.join(outDir, 'Lato-Regular.msdf.json'), 'utf8'))

    assert.strictEqual(json.pages.length, 1, 'Small charset should fit on a single page')
    assert.strictEqual(json.pages[0], 'Lato-Regular.msdf.png',
      'Single page must use the unindexed filename, not Lato-Regular.msdf_0.png')
    assert.ok(fs.existsSync(path.join(outDir, 'Lato-Regular.msdf.png')),
      'Lato-Regular.msdf.png must exist on disk')
    assert.ok(!fs.existsSync(path.join(outDir, 'Lato-Regular.msdf_0.png')),
      'Lato-Regular.msdf_0.png must not exist for a single-page atlas')
  } finally {
    fs.rmSync(srcDir, { recursive: true, force: true })
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})

// Confirms textureSize override is actually applied : forcing 256 with a large charset
// must produce multiple pages (will produce 1 with the default 2048 atlas).
test('genFont: textureSize override forces smaller atlas and triggers pagination', async () => {
  const srcDir = makeTempDir('src')
  const outDirSmall = makeTempDir('small-atlas')
  const outDirDefault = makeTempDir('default-atlas')
  try {
    fs.copyFileSync(FONT_PATH, path.join(srcDir, FONT_FILE))
    const charsetPath = path.join(srcDir, 'charset.large.json')
    fs.copyFileSync(LARGE_CHARSET_PATH, charsetPath)

    // With textureSize: 256: must produce multiple pages
    fs.writeFileSync(path.join(srcDir, 'overrides.json'), JSON.stringify({
      'Lato-Regular': { msdf: { textureSize: 256 } }
    }))
    setGeneratePaths(srcDir, outDirSmall, charsetPath)
    await genFont(FONT_FILE, 'msdf')
    const jsonSmall = JSON.parse(fs.readFileSync(path.join(outDirSmall, 'Lato-Regular.msdf.json'), 'utf8'))
    assert.ok(jsonSmall.pages.length >= 2,
      `textureSize: 256 should force >= 2 pages but got ${jsonSmall.pages.length}`)

    // Without override: same large charset on a default 2048x2048 atlas produces fewer pages
    fs.writeFileSync(path.join(srcDir, 'overrides.json'), JSON.stringify({}))
    setGeneratePaths(srcDir, outDirDefault, charsetPath)
    await genFont(FONT_FILE, 'msdf')
    const jsonDefault = JSON.parse(fs.readFileSync(path.join(outDirDefault, 'Lato-Regular.msdf.json'), 'utf8'))
    assert.ok(
      jsonDefault.pages.length < jsonSmall.pages.length,
      `Default 2048 atlas (${jsonDefault.pages.length} pages) should produce fewer pages than forced 256 atlas (${jsonSmall.pages.length} pages)`
    )
  } finally {
    fs.rmSync(srcDir, { recursive: true, force: true })
    fs.rmSync(outDirSmall, { recursive: true, force: true })
    fs.rmSync(outDirDefault, { recursive: true, force: true })
  }
})

// With an explicit textureSize, the atlas the renderer samples (scaleW/scaleH in the JSON)
// must match the actual PNG, and every glyph must fall inside it. smartSize combined with
// textureSize used to emit a PNG smaller than the reported scaleW/scaleH, which corrupted
// glyph sampling in the renderer.
test('genFont: textureSize atlas dimensions match the PNG and contain every glyph', async () => {
  const srcDir = makeTempDir('src')
  const outDir = makeTempDir('consistency')
  try {
    fs.copyFileSync(FONT_PATH, path.join(srcDir, FONT_FILE))
    const charsetPath = path.join(srcDir, 'charset.large.json')
    fs.copyFileSync(LARGE_CHARSET_PATH, charsetPath)
    fs.writeFileSync(path.join(srcDir, 'overrides.json'), JSON.stringify({
      'Lato-Regular': { msdf: { textureSize: 1024 } }
    }))

    setGeneratePaths(srcDir, outDir, charsetPath)
    await genFont(FONT_FILE, 'msdf')

    const json = JSON.parse(fs.readFileSync(path.join(outDir, 'Lato-Regular.msdf.json'), 'utf8'))

    for (let i = 0; i < json.pages.length; i++) {
      const { width, height } = pngSize(path.join(outDir, json.pages[i]))
      assert.strictEqual(width, json.common.scaleW,
        `Page ${i}: PNG width ${width} must match common.scaleW ${json.common.scaleW}`)
      assert.strictEqual(height, json.common.scaleH,
        `Page ${i}: PNG height ${height} must match common.scaleH ${json.common.scaleH}`)
    }

    for (const char of json.chars) {
      assert.ok(char.x + char.width <= json.common.scaleW && char.y + char.height <= json.common.scaleH,
        `Glyph ${char.id} at (${char.x},${char.y}) ${char.width}x${char.height} falls outside the ${json.common.scaleW}x${json.common.scaleH} atlas`)
    }
  } finally {
    fs.rmSync(srcDir, { recursive: true, force: true })
    fs.rmSync(outDir, { recursive: true, force: true })
  }
})
