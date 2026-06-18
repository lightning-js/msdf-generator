# Changelog

## 1.3.1

- Fix: removed an outdated baseline/y-offset correction in `adjustFont.ts` that was misaligning generated fonts (affects fonts generated with v1.2.0 through v1.3.0).

## 1.3.0

- Multipage atlas generation fix
- Added `textureSize` override

## 1.2.1

- Pinned `opentype.js` to `1.3.4` to fix a `loadSync` issue in newer versions

## 1.2.0

- Updated `msdf-bmfont-xml` to `^2.8.0`

## 1.1.1

- Made `presets` key optional in `<font>.config.json`

## 1.1.0

- Charset configuration with presets support

## 1.0.2

- Fixed header image URL in README for the npm page

## 1.0.0

- Initial npm publish, library exports added
