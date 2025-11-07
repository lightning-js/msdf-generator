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
import opentype from 'opentype.js';
import type { SdfFontInfo, FontFamilyInfo } from "./genFont.js";

const metricsSubDir = 'metrics';

/**
 * Adjusts the font data for the generated fonts.
 *
 * @remarks
 * A bug in the msdf-bmfont-xml package causes both the baseline and y-offsets
 * of every character to be incorrect which results in the text being rendered
 * out of intended alignment. This function corrects that data.
 *
 * See the following GitHub issue for more information:
 * https://github.com/soimy/msdf-bmfont-xml/pull/93
 *
 * @param fontInfo
 */
export async function adjustFont(fontInfo: SdfFontInfo | FontFamilyInfo) {
  console.log(chalk.magenta(`Adjusting ${chalk.bold(path.basename(fontInfo.jsonPath))}...`));
  
  // Handle FontFamilyInfo differently from SdfFontInfo
  if ('styles' in fontInfo) {
    await adjustFontFamily(fontInfo);
  } else {
    await adjustSingleFont(fontInfo);
  }
}

/**
 * Adjust a single font (SdfFontInfo)
 */
async function adjustSingleFont(fontInfo: SdfFontInfo) {
  const [jsonFileContents, font] = await Promise.all([
    fs.readFile(fontInfo.jsonPath, "utf8"),
    opentype.load(fontInfo.fontPath),
  ]);
  const json = JSON.parse(jsonFileContents);
  const distanceField = json.distanceField.distanceRange;
  /**
   * `pad` used by msdf-bmfont-xml
   *
   * (This is really just distanceField / 2 but guarantees a truncated integer result)
   */
  const pad = distanceField >> 1;

  // Remove 1x pad from the baseline
  json.common.base = json.common.base - pad;

  // Remove 2x pad from the y-offset of every character
  for (const char of json.chars) {
    char.yoffset = char.yoffset - pad - pad;
  }

  const fontMetrics = {
    ascender: font.tables.os2!.sTypoAscender as number,
    descender: font.tables.os2!.sTypoDescender as number,
    lineGap: font.tables.os2!.sTypoLineGap as number,
    unitsPerEm: font.unitsPerEm,
  };

  // Add the font metrics to the JSON
  json.lightningMetrics = fontMetrics;

  // And also write the metrics to a separate file
  const metricsDir = path.join(fontInfo.dstDir, metricsSubDir);
  const metricsFilePath = path.join(metricsDir, `${fontInfo.fontName}.metrics.json`);

  // Write the metrics file
  await Promise.all([
    (async () => {
      await fs.ensureDir(metricsDir);
      await fs.writeFile(metricsFilePath, JSON.stringify(fontMetrics, null, 2));
    })(),
    fs.writeFile(fontInfo.jsonPath, JSON.stringify(json, null, 2)),
  ]);
}

/**
 * Adjust a font family (FontFamilyInfo)
 */
async function adjustFontFamily(fontInfo: FontFamilyInfo) {
  const jsonFileContents = await fs.readFile(fontInfo.jsonPath, "utf8");
  const json = JSON.parse(jsonFileContents);
  
  // Use the first style to get reference font data (should be Regular if sorted properly)
  const firstStyle = fontInfo.styles[0];
  if (!firstStyle) {
    console.warn(`No styles found in font family ${fontInfo.fontFamily}`);
    return;
  }
  
  // Load the reference font to get metrics and adjustment data
  const font = await opentype.load(firstStyle.fontPath);
  
  let distanceField = 4; // Default fallback
  
  // Try to determine distanceField from the family JSON structure
  if (json.distanceField && json.distanceField.distanceRange) {
    distanceField = json.distanceField.distanceRange;
  }
  
  const pad = distanceField >> 1;

  // Adjust the common baseline if present
  if (json.common && json.common.base) {
    json.common.base = json.common.base - pad;
  }

  // Adjust character offsets if present
  if (json.chars) {
    for (const char of json.chars) {
      char.yoffset = char.yoffset - pad - pad;
    }
  }

  const fontMetrics = {
    ascender: font.tables.os2!.sTypoAscender as number,
    descender: font.tables.os2!.sTypoDescender as number,
    lineGap: font.tables.os2!.sTypoLineGap as number,
    unitsPerEm: font.unitsPerEm,
  };

  // Add the font metrics to the family JSON
  json.lightningMetrics = fontMetrics;

  // Write metrics files for the family
  const metricsDir = path.join(fontInfo.dstDir, metricsSubDir);
  await fs.ensureDir(metricsDir);
  
  const writePromises = [];
  
  // Check if all styles have the same metrics
  const allStyleMetrics = [];
  for (const style of fontInfo.styles) {
    const styleFont = await opentype.load(style.fontPath);
    const styleMetrics = {
      ascender: styleFont.tables.os2!.sTypoAscender as number,
      descender: styleFont.tables.os2!.sTypoDescender as number,
      lineGap: styleFont.tables.os2!.sTypoLineGap as number,
      unitsPerEm: styleFont.unitsPerEm,
    };
    allStyleMetrics.push({ style: style.fontStyle, metrics: styleMetrics });
  }
  
  // Compare all metrics to see if they're identical
  const firstMetrics = allStyleMetrics[0]?.metrics;
  const allMetricsIdentical = allStyleMetrics.every(item => 
    item.metrics.ascender === firstMetrics?.ascender &&
    item.metrics.descender === firstMetrics?.descender &&
    item.metrics.lineGap === firstMetrics?.lineGap &&
    item.metrics.unitsPerEm === firstMetrics?.unitsPerEm
  );
  
  if (allMetricsIdentical && firstMetrics) {
    // All styles have identical metrics - write a single family metrics file
    const familyMetricsPath = path.join(metricsDir, `${fontInfo.fontFamily}.metrics.json`);
    writePromises.push(fs.writeFile(familyMetricsPath, JSON.stringify(firstMetrics, null, 2)));
    console.log(chalk.cyan(`All styles have identical metrics - created shared family metrics file`));
  } else {
    // Metrics differ between styles - write individual files
    for (const item of allStyleMetrics) {
      const metricsFilePath = path.join(metricsDir, `${fontInfo.fontFamily}-${item.style}.metrics.json`);
      writePromises.push(fs.writeFile(metricsFilePath, JSON.stringify(item.metrics, null, 2)));
    }
    console.log(chalk.yellow(`Styles have different metrics - created individual metrics files`));
  }
  
  // Write the updated family JSON
  writePromises.push(fs.writeFile(fontInfo.jsonPath, JSON.stringify(json, null, 2)));
  
  await Promise.all(writePromises);
  
  console.log(chalk.green(`Adjusted family ${fontInfo.fontFamily} with ${fontInfo.styles.length} styles`));
}