/**
 * Модуль конфигурации генератора пакетов по pagex.
 *
 * @author Krylov M.A.
 */
'use strict';

const DEFAULT_PAGE_URL = 'page';
const DEFAULT_RESOURCES_URL = 'resources';
const DEFAULT_LAYOUT_MODULE = 'SabyPageLayoutPackages';
const DEFAULT_CONTENT_MODULE = 'SabyPageContentPackages';
const DEFAULT_LAYOUT_QUOTA = 0.8;
const DEFAULT_CONTENT_QUOTA = 0.5;

const EMPTY_OBJECT = Object.freeze({});

function createAllocateOptions(options) {
   const uOptions = options || EMPTY_OBJECT;
   const uLayout = uOptions.layout || EMPTY_OBJECT;
   const uContent = uOptions.content || EMPTY_OBJECT;

   return {
      layout: {
         requiredCommon: [],
         quota: DEFAULT_LAYOUT_QUOTA,
         ...uLayout
      },
      content: {
         requiredCommon: [],
         quota: DEFAULT_CONTENT_QUOTA,
         ...uContent
      }
   };
}

function createGenerateOptions(options) {
   return {
      pageUrl: DEFAULT_PAGE_URL,
      resourcesUrl: DEFAULT_RESOURCES_URL,
      layoutModule: DEFAULT_LAYOUT_MODULE,
      contentModule: DEFAULT_CONTENT_MODULE,
      ...(options || EMPTY_OBJECT)
   };
}

module.exports = {
   createAllocateOptions,
   createGenerateOptions
};
