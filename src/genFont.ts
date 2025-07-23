/*
 * Copyright 2023 Comcast Cable Communications Management, LLC
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import { fileURLToPath } from 'url'
import generateBMFont from 'msdf-bmfont-xml';
import opentype from 'opentype.js';

let fontSrcDir: string = '';
let fontDstDir: string = '';
let overridesPath = '';
let charsetPath = '';

interface PresetsData {
  [key : string]: string | undefined
}

let presets: PresetsData

/**
 * Set the paths for the font source and destination directories.
 *
 * @param srcDir
 * @param dstDir
 * @param charsetFilePath
 */
export function setGeneratePaths(srcDir: string, dstDir: string, charsetFilePath?: string ) {
  fontSrcDir = srcDir;
  fontDstDir = dstDir;
  overridesPath = path.join(fontSrcDir, 'overrides.json');
  charsetPath = charsetFilePath ? charsetFilePath : path.join(fontSrcDir, 'charset.config.json');
  presets = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'presets.json'), 'utf8'))
}

export interface SdfFontInfo {
  fontName: string;
  fieldType: 'ssdf' | 'msdf';
  fontPath: string;
  jsonPath: string;
  pngPath: string;
  pngPaths: string[];
  dstDir: string;
  fontStyle?: string;
  fontFamily?: string;
  stylePageIndex?: number;
}

export interface FontFamilyInfo {
  fontFamily: string;
  fieldType: 'ssdf' | 'msdf';
  styles: Array<{
    fontStyle: string;
    fontPath: string;
    pageIndex: number;
    pageCount?: number;
  }>;
  jsonPath: string;
  pngPaths: string[];
  dstDir: string;
}

type FontOptions = {
  fieldType: string;
  outputType: 'json';
  roundDecimal: number;
  smartSize: boolean;
  pot: boolean;
  fontSize: number;
  distanceRange: number;
  textureSize?: [number, number];
  charset?: string;
}

interface CharsetConfig{
  charset: string,
  presets: string[]
}

/**
 * Get the font style and family from a font file
 * @param fontPath - Path to the font file
 * @returns Object with fontStyle and fontFamily or undefined values if not readable
 */
function getFontInfo(fontPath: string): { fontStyle?: string; fontFamily?: string } {
  try {
    // Only try to read TTF and OTF files with opentype.js
    const ext = path.extname(fontPath).toLowerCase();
    if (ext !== '.ttf' && ext !== '.otf') {
      return {};
    }
    
    const font = opentype.loadSync(fontPath);
    
    // Get font family name (name ID 1)
    const fontFamily = font.names.fontFamily?.en;
    
    // Get font style from subfamily name (name ID 2)
    const subfamily = font.names.fontSubfamily?.en;
    let fontStyle = subfamily;
    
    if (!fontStyle || fontStyle === 'Regular') {
      // Fallback: try to extract from full font name
      const fullName = font.names.fullName?.en;
      if (fullName && fontFamily) {
        // Remove family name to get style part
        const stylePart = fullName.replace(fontFamily, '').trim();
        if (stylePart) {
          fontStyle = stylePart;
        }
      }
    }
    
    // If still no specific style found, default to Regular
    if (!fontStyle || fontStyle === fontFamily) {
      fontStyle = 'Regular';
    }
    
    return {
      fontFamily,
      fontStyle
    };
  } catch (e) {
    console.warn(`Could not read font info from ${fontPath}:`, e);
    return {};
  }
}

/**
 * Groups font files by family and generates them in a single atlas with styles on different pages
 * @param fontFiles - Array of font file names
 * @param fieldType - The type of the font field (msdf or ssdf)
 * @returns Promise<FontFamilyInfo[]> - Array of font family information
 */
export async function genFontsByFamily(fontFiles: string[], fieldType: 'ssdf' | 'msdf'): Promise<FontFamilyInfo[]> {
  console.log(chalk.blue(`Generating ${fieldType} fonts grouped by family...`));
  
  // Group fonts by family
  const fontFamilies = new Map<string, Array<{ path: string; style: string; fileName: string }>>();
  
  for (const fontFile of fontFiles) {
    const fontPath = path.join(fontSrcDir, fontFile);
    if (!fs.existsSync(fontPath)) {
      console.log(`Font ${fontFile} does not exist, skipping...`);
      continue;
    }
    
    const fontInfo = getFontInfo(fontPath);
    const family = fontInfo.fontFamily || path.parse(fontFile).name.split('-')[0] || 'Unknown';
    const style = fontInfo.fontStyle || 'Regular';
    
    if (!fontFamilies.has(family)) {
      fontFamilies.set(family, []);
    }
    
    fontFamilies.get(family)!.push({
      path: fontPath,
      style,
      fileName: fontFile
    });
  }
  
  const results: FontFamilyInfo[] = [];
  
  // Generate each family
  for (const [familyName, fonts] of fontFamilies) {
    console.log(chalk.green(`Processing family: ${familyName} with ${fonts.length} styles`));
    
    // Sort fonts to ensure Regular is first (page 0), then other styles
    const sortedFonts = fonts.sort((a, b) => {
      if (a.style.toLowerCase() === 'regular') return -1;
      if (b.style.toLowerCase() === 'regular') return 1;
      
      // Then sort alphabetically for consistency
      return a.style.localeCompare(b.style);
    });
    
    const familyResult = await generateFontFamily(familyName, sortedFonts, fieldType);
    if (familyResult) {
      results.push(familyResult);
    }
  }
  
  return results;
}

/**
 * Generate a single font family with multiple styles in one atlas
 */
async function generateFontFamily(
  familyName: string, 
  fonts: Array<{ path: string; style: string; fileName: string }>, 
  fieldType: 'ssdf' | 'msdf'
): Promise<FontFamilyInfo | null> {
  
  if (fonts.length === 0) {
    console.log(`No fonts provided for family ${familyName}`);
    return null;
  }
  
  let bmfont_field_type: string = fieldType;
  if (bmfont_field_type === 'ssdf') {
    bmfont_field_type = 'sdf';
  }
  
  // Use only family-level overrides to ensure consistent metrics across all styles
  const overrides = fs.existsSync(overridesPath) ? JSON.parse(fs.readFileSync(overridesPath, 'utf8')) : {};
  const familyOverrides = overrides[familyName];
  const font_size = familyOverrides?.[fieldType]?.fontSize || 42;
  const distance_range = familyOverrides?.[fieldType]?.distanceRange || 4;
  const textureWidth = familyOverrides?.[fieldType]?.textureWidth || 2048;
  const textureHeight = familyOverrides?.[fieldType]?.textureHeight || 2048;
  
  // Create combined charset for all presets
  let combinedCharset = '';
  if (fs.existsSync(charsetPath)) {
    const config: CharsetConfig = JSON.parse(fs.readFileSync(charsetPath, 'utf8'));
    combinedCharset = config.charset;
    const presetsToApply = config.presets ? config.presets : [];
    for (let i = 0; i < presetsToApply.length; i++) {
      const key = presetsToApply[i];
      if (key && key in presets) {
        combinedCharset += presets[key];
      } else {
        console.warn(`preset, '${key}' is not available in msdf-generator presets`);
      }
    }
  }
  
  // Generate individual style atlases first
  const styleInfos: Array<{ fontStyle: string; fontPath: string; pageIndex: number; pageCount?: number }> = [];
  const individualPngPaths: string[] = [];
  let combinedJsonData: any = null;
  
  for (let i = 0; i < fonts.length; i++) {
    const font = fonts[i]!;
    console.log(chalk.cyan(`Generating style: ${font.style} (will be page ${i})`));
    
    const options: FontOptions = {
      fieldType: bmfont_field_type,
      outputType: 'json',
      roundDecimal: 6,
      smartSize: false,
      pot: true,
      fontSize: font_size,
      distanceRange: distance_range,
      textureSize: [textureWidth, textureHeight],
      charset: combinedCharset || undefined,
    };
    
    const textureData = await generateFont(font.path, fontDstDir, `${familyName}-${font.style}`, fieldType, options);
    
    styleInfos.push({
      fontStyle: font.style,
      fontPath: font.path,
      pageIndex: i
    });
    
    individualPngPaths.push(...textureData.pngPaths);
    
    // Collect JSON data from the first style as base
    if (i === 0) {
      const jsonPath = path.join(fontDstDir, `${familyName}-${font.style}.${fieldType}.json`);
      if (fs.existsSync(jsonPath)) {
        combinedJsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
      }
    }
  }
  
  // Create a family atlas by combining individual textures into pages
  const familyPngPaths: string[] = [];
  let globalPageIndex = 0;
  
  // Update styleInfos to track page information correctly
  for (let i = 0; i < fonts.length; i++) {
    const font = fonts[i]!;
    const individualBaseName = `${familyName}-${font.style}.${fieldType}`;
    
    // Check for paginated individual files first (e.g., Ubuntu-Regular.msdf_0.png, Ubuntu-Regular.msdf_1.png)
    const files = fs.readdirSync(fontDstDir);
    const paginatedFiles = files
      .filter(file => file.startsWith(`${individualBaseName}_`) && file.endsWith('.png'))
      .sort();
    
    const startPageIndex = globalPageIndex;
    const stylePagesCount = paginatedFiles.length > 0 ? paginatedFiles.length : 1;
    
    if (paginatedFiles.length > 0) {
      console.log(chalk.cyan(`Style ${font.style} has ${paginatedFiles.length} pages`));
      
      for (let pageIndex = 0; pageIndex < paginatedFiles.length; pageIndex++) {
        const paginatedFile = paginatedFiles[pageIndex]!;
        const paginatedPath = path.join(fontDstDir, paginatedFile);
        const familyPagePath = path.join(fontDstDir, `${familyName}.${fieldType}_${globalPageIndex}.png`);
        
        fs.copyFileSync(paginatedPath, familyPagePath);
        familyPngPaths.push(familyPagePath);
        console.log(chalk.green(`Created family page ${globalPageIndex}: ${familyPagePath} (${font.style} page ${pageIndex})`));
        globalPageIndex++;
      }
    } else {
      // Fallback to single file
      const individualPath = path.join(fontDstDir, `${individualBaseName}.png`);
      if (fs.existsSync(individualPath)) {
        const familyPagePath = path.join(fontDstDir, `${familyName}.${fieldType}_${globalPageIndex}.png`);
        fs.copyFileSync(individualPath, familyPagePath);
        familyPngPaths.push(familyPagePath);
        console.log(chalk.green(`Created family page ${globalPageIndex}: ${familyPagePath} (${font.style})`));
        globalPageIndex++;
      }
    }
    
    // Update the style info with correct page information
    styleInfos[i] = {
      fontStyle: font.style,
      fontPath: font.path,
      pageIndex: startPageIndex,
      pageCount: stylePagesCount
    };
    
    // Clean up individual files (we only need the family files)
    // Remove the main individual PNG file if it exists
    const individualPath = path.join(fontDstDir, `${individualBaseName}.png`);
    if (fs.existsSync(individualPath)) {
      fs.unlinkSync(individualPath);
    }
    
    // Remove any paginated individual PNG files
    for (const file of files) {
      if (file.startsWith(`${individualBaseName}_`) && file.endsWith('.png')) {
        const paginatedPath = path.join(fontDstDir, file);
        fs.unlinkSync(paginatedPath);
        console.log(chalk.gray(`Cleaned up paginated file: ${file}`));
      }
    }
    
    // Remove individual JSON file
    const individualJsonPath = path.join(fontDstDir, `${individualBaseName}.json`);
    if (fs.existsSync(individualJsonPath)) {
      fs.unlinkSync(individualJsonPath);
    }
    console.log(chalk.gray(`Cleaned up individual files for ${font.style}`));
  }
  
  // Create a combined JSON file for the family
  if (combinedJsonData) {
    const familyJsonPath = path.join(fontDstDir, `${familyName}.${fieldType}.json`);
    
    // Modify the JSON to include style page information
    combinedJsonData.info = combinedJsonData.info || {};
    combinedJsonData.info.face = familyName;
    
    // Add pages array to match the actual number of family pages created
    combinedJsonData.pages = [];
    for (let i = 0; i < familyPngPaths.length; i++) {
      const fileName = path.basename(familyPngPaths[i] || '');
      combinedJsonData.pages.push(fileName);
    }
    
    // Add custom style mapping with page ranges
    combinedJsonData.styles = styleInfos.map(style => ({
      style: style.fontStyle,
      pageIndex: style.pageIndex,
      pageCount: style.pageCount || 1,
      pageRange: style.pageCount && style.pageCount > 1 
        ? `${style.pageIndex}-${style.pageIndex + style.pageCount - 1}`
        : `${style.pageIndex}`
    }));
    
    fs.writeFileSync(familyJsonPath, JSON.stringify(combinedJsonData, null, 2));
    console.log(chalk.green(`Created family descriptor: ${familyJsonPath}`));
    
    return {
      fontFamily: familyName,
      fieldType,
      styles: styleInfos,
      jsonPath: familyJsonPath,
      pngPaths: familyPngPaths,
      dstDir: fontDstDir
    };
  }
  
  return null;
}

/**
 * Generates a font file in the specified field type.
 * @param fontFileName - The name of the font.
 * @param fieldType - The type of the font field (msdf or ssdf).
 * @returns {Promise<void>} - A promise that resolves when the font generation is complete.
 */
export async function genFont(fontFileName: string, fieldType: 'ssdf' | 'msdf'): Promise<SdfFontInfo | null> {
  console.log(chalk.blue(`Generating ${fieldType} font from ${chalk.bold(fontFileName)}...`));
  if (fieldType !== 'msdf' && fieldType !== 'ssdf') {
    console.log(`Invalid field type ${fieldType}`);
    return null
  }
  const fontPath = path.join(fontSrcDir, fontFileName);
  if (!fs.existsSync(fontPath)) {
    console.log(`Font ${fontFileName} does not exist`);
    return null
  }

  let bmfont_field_type: string = fieldType;
  if (bmfont_field_type === 'ssdf') {
    bmfont_field_type = 'sdf';
  }

  const fontNameNoExt = fontFileName.split('.')[0]!;
  const overrides = fs.existsSync(overridesPath) ? JSON.parse(fs.readFileSync(overridesPath, 'utf8')) : {};
  const font_size = overrides[fontNameNoExt]?.[fieldType]?.fontSize || 42;
  const distance_range =
    overrides[fontNameNoExt]?.[fieldType]?.distanceRange || 4;
  const textureWidth = overrides[fontNameNoExt]?.[fieldType]?.textureWidth || 2048;
  const textureHeight = overrides[fontNameNoExt]?.[fieldType]?.textureHeight || 2048;

  let options: FontOptions = {
    fieldType: bmfont_field_type,
    outputType: 'json',
    roundDecimal: 6,
    smartSize: false, // Disable smartSize to use explicit texture dimensions
    pot: true,
    fontSize: font_size,
    distanceRange: distance_range,
    textureSize: [textureWidth, textureHeight],
  }

  if (fs.existsSync(charsetPath)) {
    const config:CharsetConfig =  JSON.parse(fs.readFileSync(charsetPath, 'utf8'))
    let charset = config.charset
    const presetsToApply = config.presets ? config.presets : []
    for (let i = 0; i < presetsToApply.length; i++ ){
      const key = presetsToApply[i]
      if (key && key in presets)  {
        charset += presets[key]
      } else {
        console.warn(`preset, '${key}' is not available in msdf-generator presets`)
      }
    }
    options['charset'] = charset
  }

  const textureData = await generateFont(fontPath, fontDstDir, fontNameNoExt, fieldType, options)

  const info: SdfFontInfo = {
    fontName: fontNameNoExt,
    fieldType,
    jsonPath: path.join(fontDstDir, `${fontNameNoExt}.${fieldType}.json`),
    pngPath: textureData.pngPaths[0] || path.join(fontDstDir, `${fontNameNoExt}.${fieldType}.png`),
    pngPaths: textureData.pngPaths,
    fontPath,
    dstDir: fontDstDir,
    stylePageIndex: 0, 
  };

  return info;
}

const generateFont = (fontSrcPath: string, fontDestPath: string, fontName: string, fieldType: string, options: FontOptions): Promise<{pngPaths: string[]}> => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(fontDestPath)) {
      fs.mkdirSync(fontDestPath, { recursive: true })
    }
    generateBMFont(
      fontSrcPath,
      options,
      (err, textures, font) => {
        if (err) {
          console.error(err)
          reject(err)
        } else {
          const pngPaths: string[] = [];
          textures.forEach((texture: any, index: number) => {
            try {
              // Handle multiple textures for pagination
              const textureFileName = textures.length > 1 
                ? `${fontName}.${fieldType}_${index}.png`
                : `${fontName}.${fieldType}.png`;
              const texturePath = path.resolve(fontDestPath, textureFileName);
              fs.writeFileSync(texturePath, texture.texture);
              pngPaths.push(texturePath);
            } catch (e) {
              console.error(e)
              reject(e)
            }
          })
          try {
            fs.writeFileSync(path.resolve(fontDestPath, `${fontName}.${fieldType}.json`), font.data)
            resolve({pngPaths})
          } catch (e) {
            console.error(err)
            reject(e)
          }
        }
      }
    )
  })
}
