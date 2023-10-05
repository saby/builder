/**
 * Модуль, предоставляющий функционал для помодульной динамической компиляции tailwind.css файла.
 * @author Krylov M.A.
 */
'use strict';

const fs = require('fs-extra');
const postcss = require('postcss');
const postcssSafeParser = require('postcss-safe-parser');
const tailwindcss = require('tailwindcss');
const autoprefixer = require('autoprefixer');

const { path } = require('../platform/path');
const TailwindTreeShaker = require('./tree-shaker');

const FILE_PATTERN = '**/*.{ts,tsx,wml,tmpl}';

async function compile(tailwindCssSnapshot, tailwindModulePath, processingModulePath) {
   const startTime = Date.now();

   const inputFilePath = path.join(tailwindModulePath, 'template.css');
   const builderConfigFilePath = path.join(tailwindModulePath, 'builder.config.js');

   const twConfig = {
      presets: [
         // eslint-disable-next-line global-require
         require(builderConfigFilePath),
      ],
      content: [
         path.join(processingModulePath, FILE_PATTERN)
      ],
      plugins: [
         // eslint-disable-next-line global-require
         require('@tailwindcss/container-queries')
      ]
   };

   const processor = postcss([
      tailwindcss(twConfig),
      autoprefixer
   ]);

   const input = await fs.readFile(inputFilePath, { encoding: 'utf-8' });

   const postCssResult = await processor.process(
      input,
      {
         parser: postcssSafeParser,
         from: processingModulePath
      }
   );

   const shaker = new TailwindTreeShaker(tailwindCssSnapshot);

   shaker.shake(postCssResult.css);

   return {
      text: shaker.text,
      classSelectors: shaker.classSelectors,
      timestamp: {
         start: startTime,
         finish: Date.now()
      }
   };
}

module.exports = compile;
