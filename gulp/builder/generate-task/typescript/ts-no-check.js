/**
 * Модуль предоставляет функционал для пользовательских конфигураций ts-no-check.json.
 *
 * @author Krylov M.A.
 */

'use strict';

const fs = require('fs-extra');
const anyMatch = require('anymatch');

const { path } = require('../../../../lib/platform/path');

function toPattern(filePath) {
   const ext = '.{ts,tsx}';

   if (filePath.endsWith('/*')) {
      return `${filePath}*/*${ext}`;
   }

   return `${filePath}${ext}`;
}

async function loadNoCheckInstruction(moduleInfo) {
   const filePath = path.join(moduleInfo.path, 'ts-no-check.json');

   if (await fs.pathExists(filePath)) {
      return fs.readJson(filePath);
   }

   return [];
}

async function loadNoCheckMatcher(cachePath, modules) {
   // Загружаем только для контролов
   const promises = modules
      .filter(moduleInfo => moduleInfo.typescript.typecheck)
      .map(loadNoCheckInstruction);

   const results = await Promise.allSettled(promises);

   const matchers = [];
   results.forEach((result) => {
      if (Array.isArray(result.value)) {
         result.value.forEach((filePath) => {
            if (typeof filePath === 'string') {
               matchers.push(toPattern(filePath));
            }
         });
      }
   });

   // Сохраним артефакт на случай разбора инцидентов
   await fs.writeJson(
      path.join(cachePath, 'ts-no-check.json'),
      matchers,
      { spaces: 3 }
   );

   return anyMatch(matchers);
}

module.exports = {
   loadNoCheckMatcher
};
