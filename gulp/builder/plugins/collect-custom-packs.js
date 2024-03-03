/**
 * Плагин для кастомной паковки. Ищет файлы *.package.json, в зависимости от наличия опции level и её значения
 * делит конфигурации для кастомной паковки на приоритетные и обычные.
 * @author Kolbeshin F.A.
 */

'use strict';

const { path } = require('../../../lib/platform/path');
const through = require('through2'),
   packHelpers = require('../../../lib/pack/helpers/custompack'),
   logger = require('../../../lib/logger').logger();

/**
 * Объявление плагина
 * @param {Object} configs все конфигурации для кастомной паковки
 * @param {string} root корень развернутого приложения
 * @returns {stream}
 */
module.exports = function collectPackageJson(taskParameters, moduleInfo, applicationRoot, configs, bundlesList) {
   const { commonBundles, superBundles } = configs;

   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();
         let currentPackageJson;

         try {
            currentPackageJson = JSON.parse(file.contents);

            /**
             * set application root as builder cache to get all configs for custom packages.
             * Needed by superbundles configs, that uses another packages for packing.
              */
            const prettyApplicationRoot = path.dirname(moduleInfo.output);
            const configPath = file.pPath.replace(prettyApplicationRoot, '');
            const configsArray = packHelpers.getConfigsFromPackageJson(
               configPath,
               currentPackageJson,
               moduleInfo
            );

            configsArray.forEach((currentConfig) => {
               const isPrivatePackage = currentConfig.includeCore && !currentConfig.platformPackage;
               const normalizedConfigOutput = `${currentConfig.output.replace(/\.js$/, '')}.min`;
               let currentBundlePath;

               /**
                * for normal bundles bundle path is relative by config path
                * for extendable bundles path to extends is relative by the
                * project's root
                */
               if (currentConfig.output) {
                  currentBundlePath = path.join(
                     'resources',
                     currentConfig.output.search(/\.js$/) !== -1 ? path.dirname(configPath) : '',
                     normalizedConfigOutput
                  );
               } else {
                  currentBundlePath = path.join(
                     'resources',
                     normalizedConfigOutput
                  );
               }

               if (bundlesList.has(currentBundlePath) || isPrivatePackage) {
                  if (currentConfig.hasOwnProperty('includePackages') && currentConfig.includePackages.length > 0) {
                     superBundles.push(currentConfig);
                  } else {
                     commonBundles[path.join(path.dirname(file.pPath), currentConfig.output)] = currentConfig;
                  }
               } else {
                  logger.warning({
                     message: `Attempt to generate new custom package ${normalizedConfigOutput}. Custom packing is deprecated! Use libraries instead!`,
                     filePath: file.pPath,
                     moduleInfo
                  });
               }
            });
         } catch (err) {
            logger.error({
               message: 'Ошибка парсинга конфигурации для кастомного пакета',
               filePath: file.pPath,
               error: err
            });
         }

         taskParameters.metrics.storePluginTime('collect custom packages', startTime);
         callback();
      }
   );
};
