/* eslint-disable no-sync, no-console */

/**
 * Общие для сборок методы работы с файлом конфигурации
 * @author Kolbeshin F.A.
 */

'use strict';

const fs = require('fs-extra');
const {
   path,
   cwd,
   toSafePosix,
   toPosix
} = require('../../lib/platform/path');

/**
 * Получить параметры командной строки, что начинаются с --
 * @param {string[]} argv спискок аргументов запуска утилиты
 * @returns {Object}
 */
function getProcessParameters(argv) {
   const result = {};
   for (const argument of argv) {
      const match = argument.match(/^--([^=]+)=['\\"]*?([^'"]*)['\\"]*?$/i);
      if (match) {
         // eslint-disable-next-line prefer-destructuring
         result[match[1]] = match[2];
      }
   }
   return result;
}

function getNormalizedRawConfig(configPath, rawConfig, options = {}) {
   const { disableSourcesPrepare, startErrorMessage } = options;
   const root = path.dirname(configPath);
   normalizeModulePaths(rawConfig, root, disableSourcesPrepare);
   normalizePaths(rawConfig, root, startErrorMessage);
   return rawConfig;
}

/**
 * Synchronously reads gulp configuration file.
 * @param {string} configPath path for gulp config
 * @param {string} currentWorkDir path to current process working directory
 * @returns {Object} JSON-formatted object of current gulp configuration
 */
function readConfigFileSync(configPath, currentWorkDir) {
   if (!configPath) {
      throw new Error('You need to set up the path to gulp configuration file.');
   }

   const resolvedConfigPath = path.resolve(currentWorkDir, configPath);
   if (!fs.pathExistsSync(resolvedConfigPath)) {
      throw new Error(`Config file '${configPath}' doesn't exists.`);
   }

   let rawConfig = {};
   const startErrorMessage = `Config file ${configPath} is invalid.`;
   try {
      rawConfig = fs.readJSONSync(resolvedConfigPath);
   } catch (e) {
      e.message = `${startErrorMessage} It must be presented in UTF8-based JSON-formatted document. Error: ${
         e.message
      }`;
      throw e;
   }
   return getNormalizedRawConfig(configPath, rawConfig, { startErrorMessage });
}

function normalizeModulePaths(rawConfig, root, disableSourcesPrepare) {
   if (!rawConfig.hasOwnProperty('modules')) {
      throw new Error('Parameter "modules" must be specified.');
   }
   if (!Array.isArray(rawConfig.modules)) {
      throw new Error('Parameter "modules" must be specified as array only.');
   }
   if (rawConfig.modules.length === 0) {
      throw new Error('Parameter "modules" cannot be specified as empty array.');
   }
   for (const module of rawConfig.modules) {
      if (!module.hasOwnProperty('path') || !module.path) {
         throw new Error(`For current module "${module.name}" path must be specified.`);
      }

      // если в конфигурации заданы относительные пути, разрешаем их в абсолютные
      if (module.path.startsWith('./') || module.path.startsWith('../')) {
         module.path = path.resolve(root, module.path);
      }

      module.path = toSafePosix(module.path);

      if (module.hasOwnProperty('compiled') && typeof module.compiled === 'string') {
         if (module.compiled.startsWith('./') || module.compiled.startsWith('../')) {
            module.compiled = path.resolve(root, module.compiled);
         }

         module.compiled = toSafePosix(module.compiled);
      }

      if (!fs.pathExistsSync(module.path) && !disableSourcesPrepare) {
         throw new Error(`Path ${module.path} doesn't exists.`);
      }
   }
}

function normalizePaths(rawConfig, root) {
   if (!rawConfig.cache) {
      rawConfig.cache = path.join(cwd(), '.builder/cache');
      console.log(`Cache directory wasn't specified. A default directory ${rawConfig.cache} is specified.`);
   }

   if (!rawConfig.output) {
      rawConfig.output = path.join(cwd(), '.builder/output');
      console.log(`Output directory wasn't specified. A default directory ${rawConfig.output} is specified.`);
   }

   /**
    * если в конфигурации заданы относительные пути для кэша, логов и конечной директории,
    * разрешаем их в абсолютные
    */
   if (rawConfig.cache.startsWith('./') || rawConfig.cache.startsWith('../')) {
      rawConfig.cache = path.resolve(root, rawConfig.cache);
   }
   if (rawConfig.output.startsWith('./') || rawConfig.output.startsWith('../')) {
      rawConfig.output = path.resolve(root, rawConfig.output);
   }

   rawConfig.cache = toPosix(rawConfig.cache);
   rawConfig.output = toPosix(rawConfig.output);

   if (rawConfig.hasOwnProperty('logs')) {
      if (rawConfig.logs.startsWith('./') || rawConfig.logs.startsWith('../')) {
         rawConfig.logs = path.resolve(root, rawConfig.logs);
      }

      rawConfig.logs = toPosix(rawConfig.logs);
   }

   if (rawConfig.hasOwnProperty('compiled') && typeof rawConfig.compiled === 'string') {
      if (rawConfig.compiled.startsWith('./') || rawConfig.compiled.startsWith('../')) {
         rawConfig.compiled = path.resolve(root, rawConfig.compiled);
      }

      rawConfig.compiled = toPosix(rawConfig.compiled);
   }
}

module.exports = {
   getProcessParameters,
   getNormalizedRawConfig,
   readConfigFileSync
};
