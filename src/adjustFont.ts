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
import type { SdfFontInfo } from "./genFont.js";

const metricsSubDir = 'metrics';

/**
 * Extracts font metrics from the source font and writes them into the
 * generated JSON and a separate metrics file.
 *
 * @param fontInfo
 */
export async function adjustFont(fontInfo: SdfFontInfo) {
  console.log(chalk.magenta(`Adjusting ${chalk.bold(path.basename(fontInfo.jsonPath))}...`));
  const [
    jsonFileContents,
    font,
  ] = await Promise.all([
    fs.readFile(fontInfo.jsonPath, 'utf8'),
    opentype.load(fontInfo.fontPath),
  ]);
  const json = JSON.parse(jsonFileContents);

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
    fs.writeFile(fontInfo.jsonPath, JSON.stringify(json, null, 2))
  ]);
}