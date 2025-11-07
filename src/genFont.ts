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
import { createCanvas, loadImage } from 'canvas';

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
  pngPath: string; // Single stitched atlas path
  originalPngPaths?: string[]; // Original multi-page paths (for debugging)
  dstDir: string;
  stitched: boolean; // Whether atlas was stitched from multiple pages
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
  const texture_size = overrides[fontNameNoExt]?.[fieldType]?.textureSize || [512, 512];

  let options: FontOptions = {
    fieldType: bmfont_field_type,
    outputType: 'json',
    roundDecimal: 6,
    smartSize: true,
    pot: true,
    fontSize: font_size,
    distanceRange: distance_range,
    textureSize: texture_size,
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

  const result = await generateFont(fontPath, fontDstDir, fontNameNoExt, fieldType, options)

  const info: SdfFontInfo = {
    fontName: fontNameNoExt,
    fieldType,
    jsonPath: path.join(fontDstDir, `${fontNameNoExt}.${fieldType}.json`),
    pngPath: result.pngPath,
    originalPngPaths: result.originalPaths,
    fontPath,
    dstDir: fontDstDir,
    stitched: result.stitched,
  };

  return info;
}

const generateFont = (fontSrcPath: string, fontDestPath: string, fontName: string, fieldType: string, options: FontOptions): Promise<{ stitched: boolean; pngPath: string; originalPaths?: string[] }> => {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(fontDestPath)) {
      fs.mkdirSync(fontDestPath, { recursive: true })
    }
    generateBMFont(
      fontSrcPath,
      options,
      async (err, textures, font) => {
        if (err) {
          console.error(err)
          reject(err)
        } else {
          try {
            const originalPaths: string[] = [];
            const tempPaths: string[] = [];
            
            // Save all original textures
            textures.forEach((texture: any, index: number) => {
              const filename = textures.length > 1 
                ? `${fontName}.${fieldType}.${index}.png`
                : `${fontName}.${fieldType}.png`;
              const fullPath = path.resolve(fontDestPath, filename);
              fs.writeFileSync(fullPath, texture.texture);
              originalPaths.push(fullPath);
              if (textures.length > 1) {
                tempPaths.push(fullPath);
              }
            });

            // Save original JSON file
            const jsonPath = path.resolve(fontDestPath, `${fontName}.${fieldType}.json`);
            fs.writeFileSync(jsonPath, font.data);

            if (textures.length > 1) {
              console.log(chalk.yellow(`Found ${textures.length} pages, stitching into single atlas...`));
              
              // Stitch textures into single atlas
              const stitchResult = await stitchTextures(
                tempPaths,
                jsonPath,
                fontDestPath,
                fontName,
                fieldType
              );

              // Write updated JSON with stitched coordinates
              fs.writeFileSync(jsonPath, JSON.stringify(stitchResult.updatedFontData, null, 2));

              // Clean up temporary multi-page files
              tempPaths.forEach(tempPath => {
                if (fs.existsSync(tempPath)) {
                  fs.unlinkSync(tempPath);
                }
              });

              console.log(chalk.green(`✓ Atlas stitched successfully: ${path.basename(stitchResult.stitchedImagePath)}`));
              
              resolve({
                stitched: true,
                pngPath: stitchResult.stitchedImagePath,
                originalPaths: originalPaths
              });
            } else {
              console.log(chalk.green(`✓ Single page - no stitching needed`));
              resolve({
                stitched: false,
                pngPath: originalPaths[0]!,
                originalPaths: originalPaths
              });
            }
          } catch (e) {
            console.error('Error during font generation or stitching:', e);
            reject(e);
          }
        }
      }
    )
  })
}

interface StitchResult {
  stitchedImagePath: string;
  updatedFontData: any;
}

interface TextureLayout {
  width: number;
  height: number;
  positions: Array<{ x: number; y: number; width: number; height: number }>;
}

/**
 * Calculate optimal layout for stitching multiple texture pages
 */
function calculateOptimalLayout(textures: any[]): TextureLayout {
  // Add padding between atlas pages to prevent bleeding artifacts
  const PADDING = 2;
  
  if (textures.length === 1) {
    return {
      width: textures[0].width || 512,
      height: textures[0].height || 512,
      positions: [{ x: 0, y: 0, width: textures[0].width || 512, height: textures[0].height || 512 }]
    };
  }

  const textureWidth = 256; // Assume standard texture size
  const textureHeight = 256;
  
  const totalWidth = textures.length * textureWidth + (textures.length - 1) * PADDING;
  const positions = textures.map((_, index) => ({
    x: index * (textureWidth + PADDING),
    y: 0,
    width: textureWidth,
    height: textureHeight
  }));

  return {
    width: totalWidth,
    height: textureHeight,
    positions
  };
}

/**
 * Stitch multiple texture pages into a single atlas
 */
async function stitchTextures(
  texturePaths: string[], 
  fontDataPath: string, 
  outputPath: string,
  fontName: string,
  fieldType: string
): Promise<StitchResult> {
  console.log(chalk.yellow(`Stitching ${texturePaths.length} texture pages into single atlas...`));

  // Load the font data to get texture dimensions and character info
  const fontData = JSON.parse(fs.readFileSync(fontDataPath, 'utf8'));
  
  // Load all texture images
  const images = await Promise.all(
    texturePaths.map(async (texturePath) => {
      try {
        return await loadImage(texturePath);
      } catch (error) {
        console.error(`Failed to load texture: ${texturePath}`, error);
        throw error;
      }
    })
  );

  // Calculate layout
  const layout = calculateOptimalLayout(
    images.map(img => ({ width: img.width, height: img.height }))
  );

  // Create large canvas with extra padding
  const canvas = createCanvas(layout.width, layout.height);
  const ctx = canvas.getContext('2d');

  // Clear canvas with transparent background
  ctx.clearRect(0, 0, layout.width, layout.height);

  // Draw each texture to the large canvas with proper positioning
  images.forEach((image, pageIndex) => {
    const position = layout.positions[pageIndex];
    if (position) {
      ctx.drawImage(image, position.x, position.y, image.width, image.height);
    }
  });

  // Save stitched image
  const buffer = canvas.toBuffer('image/png');
  const stitchedImagePath = path.resolve(outputPath, `${fontName}.${fieldType}.png`);
  fs.writeFileSync(stitchedImagePath, buffer);

  // Update character coordinates in font data
  const updatedFontData = updateCharacterCoordinates(fontData, layout);

  // Update pages array to single page
  updatedFontData.pages = [`${fontName}.${fieldType}.png`];
  updatedFontData.common.pages = 1;

  return {
    stitchedImagePath,
    updatedFontData
  };
}

/**
 * Update character coordinates after stitching
 */
function updateCharacterCoordinates(fontData: any, layout: TextureLayout): any {
  const updatedData = { ...fontData };
  
  // Update character positions based on their original page
  updatedData.chars = fontData.chars.map((char: any) => {
    const pagePosition = layout.positions[char.page];
    if (!pagePosition) {
      console.warn(`No position found for page ${char.page}, using original coordinates`);
      return { ...char, page: 0 };
    }
    return {
      ...char,
      x: char.x + pagePosition.x,
      y: char.y + pagePosition.y,
      page: 0 // All characters are now on page 0
    };
  });

  // Update texture dimensions
  updatedData.common.scaleW = layout.width;
  updatedData.common.scaleH = layout.height;

  return updatedData;
}
