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

import { adjustFont } from './adjustFont.js';
import { genFont, genFontsByFamily, setGeneratePaths } from './genFont.js';
import fs from 'fs-extra';
import chalk from 'chalk';

const fontSrcDir = 'font-src';
const fontDstDir = 'font-dst';
const font_exts = ['.ttf', '.otf', '.woff', '.woff2'];

console.log(chalk.green.bold('Lightning 3 SDF Font Generator'));

// Check if src directory exists
if (!fs.existsSync(fontSrcDir)) {
  console.log(chalk.red.bold('`font-src` directory not found. Exiting...'));
  process.exit(1);
}

fs.ensureDirSync(fontDstDir);

export async function generateFonts() {
  try {
    const files = fs.readdirSync(fontSrcDir);
    const fontFiles = files.filter(file => 
      font_exts.some(ext => file.endsWith(ext))
    );
    
    if (fontFiles.length === 0) {
      console.log(chalk.red.bold('No font files found in `font-src` directory. Exiting...'));
      process.exit(1);
    }

    // Parse command line arguments
    const args = process.argv.slice(2);
    let useFamily = false; // Default to no family grouping
    
    // Check for --individual or -i flag to use individual mode
    if (args.includes('--individual') || args.includes('-i')) {
      useFamily = false;
    }
    
    // Check for --family or -f flag to explicitly use family mode
    if (args.includes('--family') || args.includes('-f')) {
      useFamily = true;
    }
    
    // Check for --help or -h flag
    if (args.includes('--help') || args.includes('-h')) {
      console.log(chalk.cyan('\nUsage: npm run generate [options]'));
      console.log(chalk.cyan('\nOptions:'));
      console.log(chalk.cyan('  --family, -f      Group fonts by family (Only ttf/otf files)'));
      console.log(chalk.cyan('  --individual, -i  Generate individual fonts (default)'));
      console.log(chalk.cyan('  --help, -h        Show this help message'));
      console.log(chalk.cyan('\nFamily mode groups font styles (Regular, Bold, Italic) into'));
      console.log(chalk.cyan('separate pages within the same atlas for optimal WebGL performance.'));
      console.log(chalk.cyan('\nIndividual mode generates separate atlases for each font file.'));
      console.log(chalk.cyan("Woff and Woff2 formats are only supported in individual mode."));
      process.exit(0);
    }
    
    console.log(chalk.yellow(`Generation mode: ${useFamily ? 'Family grouping' : 'Individual fonts'}`));
    console.log(chalk.gray(`(Use --individual or --family to change mode, --help for options)`));
    
    if (useFamily) {
      console.log(chalk.green('\nGenerating fonts by family (styles as separate pages)...'));
      
      // Generate MSDF fonts grouped by family
      const msdfFamilies = await genFontsByFamily(fontFiles, 'msdf');
      console.log(chalk.green(`Generated ${msdfFamilies.length} MSDF families`));
      for (const family of msdfFamilies) {
        console.log(chalk.green(`Generated MSDF family: ${family.fontFamily} with ${family.styles.length} styles`));
        if (family) await adjustFont(family);
      }
      
      // Generate SSDF fonts grouped by family
      const ssdfFamilies = await genFontsByFamily(fontFiles, 'ssdf');
      for (const family of ssdfFamilies) {
        console.log(chalk.green(`Generated SSDF family: ${family.fontFamily} with ${family.styles.length} styles`));
        if (family) await adjustFont(family);
      }
    } else {
      console.log(chalk.green('\nGenerating individual fonts (original behavior)...'));
      
      // Original individual font generation
      for (const file of fontFiles) {
        const msdfFont = await genFont(file, 'msdf');
        if (msdfFont) await adjustFont(msdfFont);

        const ssdfFont = await genFont(file, 'ssdf');
        if (ssdfFont) await adjustFont(ssdfFont);
      }
    }
  } catch (error) {
    console.error(chalk.red('Error generating fonts:'), error);
    process.exit(1);
  }
}

(async () => {
  setGeneratePaths(fontSrcDir, fontDstDir);
  await generateFonts();
})().catch((err) => {
  console.log(err);
});
