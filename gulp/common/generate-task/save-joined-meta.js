/**
 * Сохраняем в корень каталога основные мета-файлы сборщика, используемые в дальнейшем
 * в онлайн-продуктах:
 * 1) contents - основная мета-информация, необходимая для настройки require и функционирования
 * приложения.
 * 2) module-dependencies - используется плагином SBIS Dependency Tree.
 * Остальные файлы(bundles.json и bundlesRoute.json) будут сохранены в соответствующей таске по
 * сохранению результатов кастомной паковки.
 * @author Kolbeshin F.A.
 */

'use strict';

const fs = require('fs-extra');
const { path } = require('../../../lib/platform/path');
const logger = require('../../../lib/logger').logger();
const { generateJoinedThemes, getThemesMeta } = require('../../../lib/save-themes');
const pMap = require('p-map');
const { generateWithStaticDependencies } = require('../../../lib/esprima/convert-to-umd');

function generateRouterContent(routerMeta, generateUMD) {
   const factoryFunctionDecl = `function(){ return ${JSON.stringify(routerMeta)}; }`;
   const moduleName = 'router';

   if (generateUMD) {
      return generateWithStaticDependencies({
         factoryFunctionCall: `define('${moduleName}', [], factory)`,
         factoryFunctionDecl
      });
   }

   return `define('${moduleName}', [], ${factoryFunctionDecl})`;
}

function isObject(item) {
   return (item && typeof item === 'object' && !Array.isArray(item));
}

function mergeDeep(target, source) {
   const output = Object.assign({}, target);
   if (isObject(target) && isObject(source)) {
      Object.keys(source).forEach((key) => {
         if (isObject(source[key])) {
            if (!(key in target)) {
               Object.assign(output, { [key]: source[key] });
            } else {
               output[key] = mergeDeep(target[key], source[key]);
            }
         } else {
            Object.assign(output, { [key]: source[key] });
         }
      });
   }
   return output;
}

/**
 * Reads all of "router.json" meta from interface modules
 * and saves them into joined meta in application root
 * @param modules - list of modules to be processed
 * @returns {Promise<{}>}
 */
async function readAndJoinIcons(modules) {
   const resultMeta = {};
   await pMap(
      modules,
      async(moduleInfo) => {
         const currentMetaPath = path.join(moduleInfo.output, 'icons.json');
         try {
            if (await fs.pathExists(currentMetaPath)) {
               const currentMetaData = await fs.readJson(currentMetaPath);
               resultMeta[moduleInfo.outputName] = currentMetaData;
            }
         } catch (error) {
            logger.error({
               message: 'Error occurred while reading "icons.jsons" meta for current interface module',
               error,
               moduleInfo
            });
         }
      }
   );
   return resultMeta;
}

/**
 * Reads all of "router.json" meta from interface modules
 * and saves them into joined meta in application root
 * @param modules - list of modules to be processed
 * @returns {Promise<{}>}
 */
async function readAndJoinMetaByName(modules, metaName) {
   let resultMeta = {};
   const modulesMeta = {};
   await pMap(
      modules,
      async(moduleInfo) => {
         const currentMetaPath = path.join(moduleInfo.output, metaName);
         try {
            if (await fs.pathExists(currentMetaPath)) {
               modulesMeta[moduleInfo.outputName] = await fs.readJson(currentMetaPath);
            }
         } catch (error) {
            logger.error({
               message: `Error occurred while reading "${metaName}" meta for current interface module`,
               error,
               moduleInfo
            });
         }
      }
   );
   Object.keys(modulesMeta).forEach((currentModule) => {
      resultMeta = mergeDeep(resultMeta, modulesMeta[currentModule]);
   });
   return resultMeta;
}

/**
 * Save themes into ThemesModule in output directory
 * @param{TaskParameters} taskParameters a whole task parameters
 * @param{String} root - application root
 * @param{boolean} isThemeForReleaseOnly - a sign whether file should be built in debug mode
 * @param{string} fileSuffix - suffix for theme extension
 * @returns {Promise<void>}
 */
async function saveThemes(taskParameters, root, isThemeForReleaseOnly, fileSuffix) {
   const themes = await getThemesMeta(taskParameters);
   const resourceRoot = `${taskParameters.config.applicationForRebase}${taskParameters.config.resourcesUrl ? 'resources/' : ''}`;
   await generateJoinedThemes(
      taskParameters,
      root,
      isThemeForReleaseOnly,
      fileSuffix,
      themes,
      resourceRoot
   );
}

/**
 * Генерация задачи сохранения в корень каталога основных мета-файлов сборщика
 * @param{Object} taskParameters
 * @returns {*}
 */
module.exports = function generateTaskForSaveJoinedMeta(taskParameters) {
   const root = taskParameters.config.rawConfig.output;
   const fileSuffix = taskParameters.config.isReleaseMode ? '.min' : null;
   const isThemeForReleaseOnly = !taskParameters.config.sources && taskParameters.config.isReleaseMode;
   const { projectWithoutChangesInFiles } = taskParameters.config;

   if (!taskParameters.config.joinedMeta) {
      return async function saveOnlyThemesMeta() {
         const startTime = Date.now();

         await fs.outputJson(path.join(root, 'interfaceRoute.json'), taskParameters.getInterfaceRoute());
         await saveThemes(taskParameters, root, isThemeForReleaseOnly, fileSuffix);

         taskParameters.metrics.storeTaskTime('save presentation service meta', startTime);
      };
   }

   // save joined meta for non-jinnee application
   return async function saveJoinedMeta() {
      const startTime = Date.now();

      await saveThemes(taskParameters, root, isThemeForReleaseOnly, fileSuffix);

      if (taskParameters.config.dependenciesGraph) {
         let moduleDeps;
         if (projectWithoutChangesInFiles) {
            moduleDeps = await readAndJoinMetaByName(taskParameters.config.modules, 'module-dependencies.json');
         } else {
            moduleDeps = taskParameters.cache.getModuleDependencies();
         }
         await fs.writeJson(path.join(root, 'module-dependencies.json'), moduleDeps);
         if (taskParameters.config.isReleaseMode) {
            await fs.writeJson(path.join(root, 'module-dependencies.min.json'), moduleDeps);
         }
      }

      await fs.writeFile(path.join(root, 'bundles.js'), 'bundles={};');

      if (taskParameters.config.contents) {
         let { commonContents } = taskParameters.config;
         if (projectWithoutChangesInFiles) {
            commonContents = await readAndJoinMetaByName(taskParameters.config.modules, 'contents.json');
         }
         if (commonContents) {
            await fs.writeJson(
               path.join(
                  root,
                  'contents.json'
               ),
               commonContents
            );
            await fs.writeFile(
               path.join(
                  root,
                  'contents.js'
               ),
               `contents=${JSON.stringify(commonContents)};`
            );
            if (taskParameters.config.isReleaseMode) {
               await fs.writeFile(
                  path.join(
                     root,
                     'contents.min.js'
                  ),
                  `contents=${JSON.stringify(commonContents)};`
               );
            }
         }
      }

      let { commonIcons } = taskParameters.config;
      if (projectWithoutChangesInFiles) {
         commonIcons = await readAndJoinIcons(taskParameters.config.modules);
      }

      if (commonIcons) {
         await fs.writeJson(
            path.join(
               root,
               'icons.json'
            ),
            commonIcons
         );
         if (taskParameters.config.isReleaseMode) {
            await fs.writeJson(
               path.join(
                  root,
                  'icons.min.json'
               ),
               commonIcons
            );
         }
      }

      const routerMeta = await readAndJoinMetaByName(taskParameters.config.modules, 'router.json');
      const routerContent = generateRouterContent(routerMeta, taskParameters.config.generateUMD);
      await fs.writeFile(path.join(root, 'router.js'), routerContent);

      if (taskParameters.config.isReleaseMode) {
         await fs.writeFile(path.join(root, 'router.min.js'), routerContent);
      }

      // custom pack is incremental, so we need to copy custompack meta from cache into output
      if (root !== taskParameters.config.outputPath) {
         const bundlesPath = taskParameters.config.outputPath;
         if (await fs.pathExists(path.join(bundlesPath, 'bundles.json'))) {
            await fs.copy(path.join(bundlesPath, 'bundles.json'), path.join(root, 'bundles.json'));
         }
         if (await fs.pathExists(path.join(bundlesPath, 'bundlesRoute.json'))) {
            await fs.copy(path.join(bundlesPath, 'bundlesRoute.json'), path.join(root, 'bundlesRoute.json'));
         }
         if (await fs.pathExists(path.join(bundlesPath, 'bundles.min.js'))) {
            await fs.copy(path.join(bundlesPath, 'bundles.min.js'), path.join(root, 'bundles.min.js'));
         }
      }

      taskParameters.metrics.storeTaskTime('save presentation service meta', startTime);
   };
};

module.exports.generateRouterContent = generateRouterContent;
