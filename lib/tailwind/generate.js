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

async function getTailwindTemplateFilePath(config) {
   // Исключительно для совместимости в локальных сборках. Будет удалено в следующую версию
   const inputFilePath = path.join(config.tailwindModulePath, 'tailwind.template');

   if (await fs.pathExists(inputFilePath)) {
      return inputFilePath;
   }

   return path.join(config.tailwindModulePath, 'tailwind.css');
}

async function compile(config) {
   const startTime = Date.now();

   const inputFilePath = await getTailwindTemplateFilePath(config);
   const builderConfigFilePath = path.join(config.tailwindModulePath, 'builder.config.js');

   const twConfig = {
      presets: [
         // eslint-disable-next-line global-require
         require(builderConfigFilePath),
      ],
      content: config.content,
      plugins: [
         // eslint-disable-next-line global-require
         require('@tailwindcss/container-queries')
      ]
   };

   const processor = postcss([
      tailwindcss(twConfig),
      autoprefixer({ remove: false })
   ]);

   const input = await fs.readFile(inputFilePath, { encoding: 'utf-8' });

   const postCssResult = await processor.process(
      input,
      {
         parser: postcssSafeParser,
         from: config.processingModulePath
      }
   );

   const shaker = new TailwindTreeShaker(config.tailwindCssSnapshot);

   shaker.shake(postCssResult.css);

   if (config.cachedSnapshot) {
      shaker.merge(config.cachedSnapshot);
   }

   return {
      root: shaker.root,
      text: shaker.text,
      classSelectors: shaker.classSelectors,
      timestamp: {
         start: startTime,
         finish: Date.now()
      }
   };
}

module.exports = compile;
