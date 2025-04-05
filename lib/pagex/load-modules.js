/**
 * Модуль предоставляет функционал для чтения *.pagex файла и загрузки зависимостей определенных страниц.
 * @author Krylov M.A.
 */
'use strict';

const Application = require('../wasaby/application');
const parseSourceFile = require('./parser');
const { prepareLayouts } = require('./utils');

const application = new Application();

/**
 * Получить список страниц с зависимостями по набору данных из pagex файла.
 * @param {string} filePath Путь до файла.
 * @param {Object} contents Содержимое pagex файла.
 * @returns {Promise<{pages: Object[], timestamp: {start: number, finish: number}}>}
 */
async function getContentModules(filePath, contents) {
   const startTime = Date.now();

   application.init();

   const rawData = await parseSourceFile(filePath, contents);
   const pages = await application.startRequest(
      'SabyPage/base',
      SabyPage => SabyPage.getContentModules(rawData)
   );

   return {
      pages,
      timestamp: {
         start: startTime,
         finish: Date.now()
      }
   };
}

/**
 * Получить список раскладок и их зависимостей.
 * @returns {Promise<{layouts: Object[], timestamp: {start: number, finish: number}}>}
 */
async function getLayoutModules() {
   const startTime = Date.now();

   application.init();

   const layouts = await application.startRequest(
      'SabyPage/base',
      SabyPage => SabyPage.getLayoutModules()
   );

   prepareLayouts(layouts);

   return {
      layouts,
      timestamp: {
         start: startTime,
         finish: Date.now()
      }
   };
}

module.exports = {
   getContentModules,
   getLayoutModules
};
