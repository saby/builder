/**
 * Плагин для удаления из потока Gulp исходников и мета-файлов,
 * которые не должны попасть в конечную директорию. Актуально для
 * Desktop-приложений.
 * @author Kolbeshin F.A.
 */

'use strict';

const through = require('through2');
const { checkSourceNecessityByConfig } = require('../../common/helpers');
const builderMeta = new Set([
   'module-dependencies.json',
   'navigation-modules.json',
   'routes-info.json',
   'static_templates.json'
]);
const metaFilesToCopy = new Set([
   'contents.json',
   'bundles.json',
   'bundlesRoute.json',
   'packageMap.json',
   'versioned_modules.json',
   'cdn_modules.json',
   'link_dependencies.json'
]);
const { path, toSafePosix, removeLeadingSlashes } = require('../../../lib/platform/path');
const extensions = new Set([
   '.js',
   '.tmpl',
   '.xhtml',
   '.less',
   '.wml',
   '.json',
   '.jstpl',
   '.css',
   '.ts',
   '.map'
]);
const privateModuleExt = /(\.min)?(\.js|\.wml|\.tmpl)/;

function getModuleNameWithPlugin(file, moduleInfo) {
   const prettyRoot = path.dirname(moduleInfo.output);
   const prettySourceRoot = path.dirname(moduleInfo.path);
   const prettyRelativePath = removeLeadingSlashes(file.pPath.replace(prettyRoot, ''));
   const prettySourceRelativePath = removeLeadingSlashes(file.pHistory[0].replace(prettySourceRoot, ''));
   const currentModuleName = prettyRelativePath.replace(privateModuleExt, '');
   const currentPlugin = file.pExtname.slice(1, file.pExtname.length);
   const result = {
      currentRelativePath: prettyRelativePath,
      sourceRelativePath: prettySourceRelativePath
   };

   switch (currentPlugin) {
      case 'tmpl':
      case 'wml':
      case 'css':
         result.normalizedModuleName = `${currentPlugin}!${currentModuleName}`;
         break;
      case 'xhtml':
         result.normalizedModuleName = `html!${currentModuleName}`;
         break;
      default:
         result.normalizedModuleName = currentModuleName;
         break;
   }
   return result;
}

/**
 * Объявление плагина
 * @returns {stream}
 */
module.exports = function declarePlugin(taskParameters, moduleInfo) {
   const buildConfig = taskParameters.config;
   const filesToCheck = [];
   const currentModuleName = toSafePosix(moduleInfo.output).split('/').pop();
   let moduleDepsMetaFile;

   return through.obj(
      function onTransform(file, encoding, callback) {
         const startTime = Date.now();

         const isFileFromCustomPacking = (
            file.pBasename.endsWith('.min.original.js') ||
            file.pBasename.endsWith('.package.json') ||
            taskParameters.packedFiles.has(file.pPath)
         );

         if (isFileFromCustomPacking) {
            callback(null);
            return;
         }

         if (file.pBasename === 'module-dependencies.json') {
            moduleDepsMetaFile = file;
            callback(null);
            taskParameters.metrics.storePluginTime('copy sources', startTime);
            return;
         }

         if (metaFilesToCopy.has(file.pBasename)) {
            callback(null, file);
            taskParameters.metrics.storePluginTime('copy sources', startTime);
            return;
         }

         /**
          * не копируем мета-файлы билдера.
          */
         if (builderMeta.has(file.pBasename)) {
            if (taskParameters.config.builderTests) {
               callback(null, file);
            } else {
               callback(null);
            }
            taskParameters.metrics.storePluginTime('copy sources', startTime);
            return;
         }

         /**
          * если файл нестандартного расширения, сразу копируем.
          */
         if (!extensions.has(file.pExtname)) {
            callback(null, file);
            taskParameters.metrics.storePluginTime('copy sources', startTime);
            return;
         }

         if (!checkSourceNecessityByConfig(buildConfig, file.pExtname)) {
            callback(null);
            taskParameters.metrics.storePluginTime('copy sources', startTime);
            return;
         }

         const debugMode = !buildConfig.minimize;
         const isMinified = file.pBasename.endsWith(`.min${file.pExtname}`);
         switch (file.pExtname) {
            case '.js':
               /**
                * нужно скопировать .min.original модули, чтобы не записать в кастомный
                * пакет шаблон компонента 2 раза
                */
               if (debugMode || isMinified || file.pBasename.endsWith('.min.original.js')) {
                  filesToCheck.push(file);
                  callback(null);
                  taskParameters.metrics.storePluginTime('copy sources', startTime);
                  return;
               }
               callback(null);
               taskParameters.metrics.storePluginTime('copy sources', startTime);
               return;
            case '.json':
               /**
                * конфиги для кастомной паковки нужно скопировать, чтобы создались кастомные пакеты
                */
               if (debugMode || isMinified || file.pBasename.endsWith('.package.json')) {
                  callback(null, file);
                  taskParameters.metrics.storePluginTime('copy sources', startTime);
                  return;
               }
               callback(null);
               taskParameters.metrics.storePluginTime('copy sources', startTime);
               return;
            case '.less':
            case '.ts':
               callback(null);
               taskParameters.metrics.storePluginTime('copy sources', startTime);
               return;

            // templates, .css, .jstpl, typescript sources, less
            default:
               if (debugMode || isMinified) {
                  filesToCheck.push(file);
               }
               callback(null);
               taskParameters.metrics.storePluginTime('copy sources', startTime);
               break;
         }
      },

      /* @this Stream */
      function onFlush(callback) {
         const startTime = Date.now();
         const moduleDeps = taskParameters.cache.getModuleDependencies();
         const currentModulePrivateLibraries = new Set();
         const modulesToRemoveFromMeta = new Map();

         Object.keys(moduleDeps.packedLibraries)
            .filter(currentLibrary => currentLibrary.startsWith(currentModuleName))
            .forEach((currentLibrary) => {
               moduleDeps.packedLibraries[currentLibrary].forEach(
                  currentModule => currentModulePrivateLibraries.add(currentModule)
               );
            });
         filesToCheck.forEach((file) => {
            const {
               normalizedModuleName,
               currentRelativePath
            } = getModuleNameWithPlugin(file, moduleInfo);

            // remove from gulp stream packed into libraries files
            if (currentModulePrivateLibraries.has(normalizedModuleName)) {
               modulesToRemoveFromMeta.set(currentRelativePath, normalizedModuleName);
               taskParameters.metrics.storePluginTime('copy sources', startTime);
               return;
            }
            this.push(file);
         });

         /**
          * we have to remove all private modules of packed libraries from
          * module-dependencies meta because of theirs further non-existing in
          * desktop applications.
          */
         currentModulePrivateLibraries.forEach((moduleName) => {
            delete moduleDeps.nodes[moduleName];
            delete moduleDeps.links[moduleName];
            Object.keys(moduleDeps.links).forEach((currentLink) => {
               if (moduleDeps.links[currentLink].includes(moduleName)) {
                  delete moduleDeps.links[currentLink];
               }
            });
         });

         if (moduleDepsMetaFile) {
            moduleDepsMetaFile.contents = Buffer.from(JSON.stringify(moduleDeps));
            if (taskParameters.config.builderTests) {
               this.push(moduleDepsMetaFile);
            }
         }
         if (taskParameters.config.version) {
            const filterFunction = currentPath => !modulesToRemoveFromMeta.has(currentPath);

            // remove private parts of libraries from versioned and cdn meta
            taskParameters.filterMeta(currentModuleName, 'versionedModules', filterFunction);
            taskParameters.filterMeta(currentModuleName, 'cdnModules', filterFunction);
         }

         callback();
         taskParameters.metrics.storePluginTime('copy sources', startTime);
      }
   );
};
