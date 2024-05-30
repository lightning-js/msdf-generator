import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
let fontSrcDir = '';
let fontDstDir = '';
let overridesPath = '';
let charsetPath = '';
/**
 * Set the paths for the font source and destination directories.
 *
 * @param srcDir
 * @param dstDir
 */
export function setGeneratePaths(srcDir, dstDir) {
    fontSrcDir = srcDir;
    fontDstDir = dstDir;
    overridesPath = path.join(fontSrcDir, 'overrides.json');
    charsetPath = path.join(fontSrcDir, 'charset.txt');
}
/**
 * Generates a font file in the specified field type.
 * @param fontFileName - The name of the font.
 * @param fieldType - The type of the font field (msdf or ssdf).
 * @returns {Promise<void>} - A promise that resolves when the font generation is complete.
 */
export async function genFont(fontFileName, fieldType) {
    console.log(chalk.blue(`Generating ${fieldType} font from ${chalk.bold(fontFileName)}...`));
    if (fieldType !== 'msdf' && fieldType !== 'ssdf') {
        console.log(`Invalid field type ${fieldType}`);
        return null;
    }
    const fontPath = path.join(fontSrcDir, fontFileName);
    if (!fs.existsSync(fontPath)) {
        console.log(`Font ${fontFileName} does not exist`);
        return null;
    }
    let bmfont_field_type = fieldType;
    if (bmfont_field_type === 'ssdf') {
        bmfont_field_type = 'sdf';
    }
    const fontNameNoExt = fontFileName.split('.')[0];
    const overrides = fs.existsSync(overridesPath) ? JSON.parse(fs.readFileSync(overridesPath, 'utf8')) : {};
    const font_size = overrides[fontNameNoExt]?.[fieldType]?.fontSize || 42;
    const distance_range = overrides[fontNameNoExt]?.[fieldType]?.distanceRange || 4;
    // await generateFont(fontPath, fontDstDir, fontNameNoExt, fieldType, options)
    await execa('msdf-bmfont', [
        '--field-type',
        bmfont_field_type,
        '--output-type',
        'json',
        '--round-decimal',
        '6',
        '--smart-size',
        '--pot',
        '--font-size',
        `${font_size}`,
        '--distance-range',
        `${distance_range}`,
        ...(fs.existsSync(charsetPath) ? ['--charset-file', charsetPath] : []),
        fontPath,
    ]);
    const info = {
        fontName: fontNameNoExt,
        fieldType,
        jsonPath: path.join(fontDstDir, `${fontNameNoExt}.${fieldType}.json`),
        pngPath: path.join(fontDstDir, `${fontNameNoExt}.${fieldType}.png`),
        fontPath,
        dstDir: fontDstDir,
    };
    fs.renameSync(path.join(fontSrcDir, `${fontNameNoExt}.json`), info.jsonPath);
    fs.renameSync(path.join(fontSrcDir, `${fontNameNoExt}.png`), info.pngPath);
    return info;
}
//# sourceMappingURL=genFont.js.map