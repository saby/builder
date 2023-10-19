/**
 * Common helpers for builder
 * @author Kolbeshin F.A.
 */

'use strict';

const fs = require('fs-extra');
const crypto = require('crypto');
const zlib = require('zlib');
const { requirejsPlugins, TOTAL_MEMORY, isWindows } = require('./builder-constants');
const { generateWithStaticDependencies } = require('./espree/convert-to-umd');
const logger = require('./logger').logger();
const { path } = require('./platform/path');

const gzOptions = {
   level: 5,
   strategy: zlib.Z_DEFAULT_STRATEGY
};
const brotliOptions = {
   params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: 7
   }
};
const jsExt = /\.js$/;
const { TS_EXT } = require('./builder-constants');

async function shouldRemoveFromStream(file) {
   /**
    * Если имеется скомпилированный вариант для typescript или ES6 в исходниках, нам необходимо
    * выкинуть его из потока Gulp, чтобы не возникало ситуации, когда в потоке будут
    * 2 одинаковых модуля и билдер попытается создать 2 симлинка. Актуально также для релизной
    * сборки, когда скомпилированный для typescript модуль в исходниках может перебить скомпилированный
    * билдером typescript модуль.
    */
   if (file.pExtname === '.js') {
      const tsInSource = await fs.pathExists(file.pPath.replace(jsExt, '.ts'));
      const tsxInSource = await fs.pathExists(file.pPath.replace(jsExt, '.tsx'));

      return (tsInSource || tsxInSource);
   }

   return false;
}

function calcHash(content, algorithm) {
   return crypto
      .createHash('sha1')
      .update(content)
      .digest(algorithm);
}

function sortObject(obj, comparator) {
   const sorted = {};
   Object.keys(obj)
      .sort(comparator)
      .forEach((key) => {
         const val = obj[key];
         if (Array.isArray(val)) {
            sorted[key] = val.sort();
         } else if (val instanceof Object) {
            sorted[key] = sortObject(val, comparator);
         } else {
            sorted[key] = val;
         }
      });
   return sorted;
}

function gzip(data) {
   return new Promise((resolve, reject) => {
      zlib.gzip(data, gzOptions, (err, compressed) => {
         if (err) {
            reject(err);
         } else {
            resolve(compressed);
         }
      });
   });
}

/**
 * Get compressed to brotli source text.
 * Compress quality selected to 7. Reason:
 * optimal quality by speed and result size.
 * @param {ArrayBuffer} data source text
 * @returns {Promise}
 */
function brotli(data) {
   return new Promise((resolve, reject) => {
      zlib.brotliCompress(data, brotliOptions, (err, compressed) => {
         if (err) {
            reject(err);
         } else {
            resolve(compressed);
         }
      });
   });
}

const promisifyDeferred = function(deferred) {
   return new Promise((resolve, reject) => {
      deferred
         .addCallback((result) => {
            resolve(result);
         })
         .addErrback((error) => {
            reject(error);
         });
   });
};

/**
 * Сравнивает два объекта без рекурсии
 * @param {Object} a перый аргумент
 * @param {Object} b второй аргумент
 * @returns {boolean}
 */
function isEqualObjectFirstLevel(a, b) {
   if (!a || !b) {
      return false;
   }

   const arrKey = Object.keys(a);

   if (arrKey.length !== Object.keys(b).length) {
      return false;
   }

   return arrKey.every((key) => {
      if (b.hasOwnProperty(key) && a[key] === b[key]) {
         return true;
      }
      return false;
   });
}

/**
 * Удаляем из мета-данных о версионированных файлах информацию
 * о файлах, которые будут удалены при выполнении таски
 * оптимизации дистрибутива.
 * @param versionedMeta
 * @param fullPath
 */
function removeFileFromBuilderMeta(builderMeta, fullPath) {
   let removeFromVersioned;

   // remove module from meta if current meta exists
   if (builderMeta instanceof Array) {
      builderMeta.forEach((versionedModule) => {
         if (fullPath.endsWith(versionedModule)) {
            removeFromVersioned = versionedModule;
         }
      });
      if (removeFromVersioned) {
         logger.debug(`Module ${fullPath} is removed from versioned_modules meta`);
         const moduleIndex = builderMeta.indexOf(removeFromVersioned);
         builderMeta.splice(moduleIndex, 1);
      }
   }
}

/**
 * Добавляем в корневой contents всю информацию из помодульного contents.
 * @param {Object} commonContents - корневой contents
 * @param {Object} currentContents - модульный contents
 */
function joinContents(commonContents, currentContents) {
   Object.keys(currentContents).forEach((currentOption) => {
      if (currentContents.hasOwnProperty(currentOption)) {
         switch (typeof currentContents[currentOption]) {
            case 'object':
               if (!commonContents.hasOwnProperty(currentOption)) {
                  commonContents[currentOption] = {};
               }
               Object.keys(currentContents[currentOption]).forEach((subOption) => {
                  if (currentContents[currentOption].hasOwnProperty(subOption)) {
                     commonContents[currentOption][subOption] = currentContents[currentOption][subOption];
                  }
               });
               break;
            case 'string':
            case 'boolean':
               commonContents[currentOption] = currentContents[currentOption];
               break;
            default:
               break;
         }
      }
   });
}

/**
 * нас не интересуют:
 * не js-файлы
 * *.test.js - тесты
 * *.worker.js - воркеры
 * *.profiling.js - React-файлы, используемые в крайних случаях для отладки
 * При востребовании можно их подменить фиддлером, в парсинге они не нуждаются
 * *.routes.js - роутинг. обрабатывается в отдельном плагин
 * файлы в папках design - файлы для макетирования в genie
 * jquery также не должен парситься, это модуль с cdn.
 * @param file
 * @returns {boolean|*}
 */
function componentCantBeParsed(file) {
   return file.pExtname !== '.js' ||
      file.pPath.endsWith('.worker.js') ||
      file.pPath.endsWith('.profiling.min.js') ||
      file.pPath.endsWith('.test.js') ||
      file.pPath.includes('/design/') ||
      file.pPath.includes('/node_modules/') ||
      file.pPath.includes('/JitsiConference/third-party/') ||
      file.pPath.includes('/third-party/server/') ||
      file.pBasename.includes('jquery-min') ||
      file.pBasename.includes('jquery-full');
}

/**
 * sorts input array in descending order
 * @param array
 * @returns {*}
 */
function descendingSort(array, optionToCompare) {
   return array.sort((a, b) => {
      const firstValue = optionToCompare ? a[optionToCompare] : a;
      const secondValue = optionToCompare ? b[optionToCompare] : b;
      if (firstValue < secondValue) {
         return 1;
      }

      if (secondValue < firstValue) {
         return -1;
      }

      return 0;
   });
}

function getCurrentNodePlugin(fullName) {
   let result = '';
   requirejsPlugins.forEach((currentPlugin) => {
      if (fullName.includes(`${currentPlugin}!`)) {
         result = currentPlugin;
      }
   });
   return result;
}

function generateContentsContent(uiModuleName, sortedContents, generateUMD) {
   const factoryFunctionDecl = `function(){return ${sortedContents};}`;
   const moduleName = `${uiModuleName}/contents.json`;

   if (generateUMD) {
      return generateWithStaticDependencies({
         factoryFunctionCall: `define('${moduleName}', [], factory)`,
         factoryFunctionDecl
      });
   }

   return `define('${moduleName}',[],${factoryFunctionDecl});`;
}

/**
 * gets Facade name
 * @param {ModuleInfo} moduleInfo - full information about current interface module. Needed by logger.
 * @param {PosixVinyl} file - current processing file.
 * @returns {string}
 */
function getFacadeName(moduleInfo, file) {
   const relativePath = path.relative(moduleInfo.appRoot, file.pHistory[0]);
   return `${moduleInfo.outputName}/${relativePath.replace(TS_EXT, '')}`;
}

function getHeapSizeCommand() {
   const allowedMemory = Math.trunc(TOTAL_MEMORY * 0.5);
   if (isWindows) {
      return `set NODE_OPTIONS="--max-old-space-size=${allowedMemory}"`;
   }
   return `export NODE_OPTIONS='--max-old-space-size=${allowedMemory}'`;
}

module.exports = {
   shouldRemoveFromStream,
   calcHash,
   sortObject,
   getCurrentNodePlugin,
   promisifyDeferred,
   gzip,
   brotli,
   isEqualObjectFirstLevel,
   removeFileFromBuilderMeta,
   joinContents,
   componentCantBeParsed,
   descendingSort,
   generateContentsContent,
   getFacadeName,
   getHeapSizeCommand
};
