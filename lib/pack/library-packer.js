/**
 * Паковщик библиотек. Используется в соответствующем Gulp-плагине сборщика:
 * builder/gulp/builder/plugins/pack-library.js
 * @author Kolbeshin F.A.
 */

'use strict';

const libPackHelpers = require('./helpers/librarypack');
const { parseCode } = require('../espree/common');
const { isPrivate } = require('../espree/library');
const { path } = require('../../lib/platform/path');
const logger = require('../logger').logger();
const pMap = require('p-map');
const {
   generateLibrary,
   getSourcePathByModuleName
} = require('../espree/generate-library');

function checkDependencyForExisting(dependencyName, privateDependenciesSet) {
   let existsInSet = false;

   privateDependenciesSet.forEach((dependency) => {
      if (dependency.moduleName === dependencyName) {
         existsInSet = true;
      }
   });

   return existsInSet;
}

function checkForExternalDep(dependency, libraryName) {
   const dependencyParts = dependency.split('/');
   const dependencyModule = dependencyParts[0].split(/!|\?/).pop();
   const libraryModule = libraryName.split('/')[0];

   return dependencyModule === libraryModule;
}

async function dependencyWalker(
   options,
   sourceRoot,
   outputRoot,
   libraryName,
   currentDepTree,
   parentDependency,
   currentDependency,
   libraryDependenciesMeta,
   externalDependenciesToPush,
   privateModulesCache,
   privatePartsForCache,
   result,
   dependenciesTreeError
) {
   let newDepTree;

   /**
    * Приватные css-зависимости будем пока просить как внешние зависимости.
    * TODO спилить по выполнении задачи https://online.sbis.ru/opendoc.html?guid=0a57d162-b24c-4a9e-9bc2-bac22139b2ee
    * С плагином i18n та же история, нужно реализовать имитацию работы данного плагина на
    * паковщике библиотек.
    */
   if (currentDependency.startsWith('css!') || currentDependency.startsWith('i18n!') || currentDependency.startsWith('json!')) {
      if (!externalDependenciesToPush.includes(currentDependency)) {
         externalDependenciesToPush.push(currentDependency);
      }

      return;
   }

   if (!checkForExternalDep(currentDependency, libraryName)) {
      logger.error(`attempt to load external private module: ${currentDependency}. Parent module: ${parentDependency}`);
      dependenciesTreeError.type = 'external private module';
      return;
   }

   if (!currentDepTree.has(currentDependency)) {
      const dependencyContent = await libPackHelpers.readModuleAndGetParamsNames(
         options,
         sourceRoot,
         outputRoot,
         libraryName,
         currentDependency,
         libraryDependenciesMeta,
         externalDependenciesToPush,
         privateModulesCache
      );
      const currentPrivateDependencies = dependencyContent.dependencies.filter((dep) => {
         if (dep === libraryName) {
            logger.error({
               message: `Cycle library dependency. Parent module: ${currentDependency}`,
               filePath: `${path.join(sourceRoot, libraryName)}.js`
            });
            dependenciesTreeError.type = 'cycle dependency';
         }

         return isPrivate(dep);
      });

      newDepTree = new Set([...currentDepTree, currentDependency]);

      const shouldAddDependency = (
         !dependencyContent.externalDependency &&
         !checkDependencyForExisting(dependencyContent.moduleName, result)
      );

      if (shouldAddDependency) {
         dependencyContent.hasNoExports = libPackHelpers.hasNoExports(dependencyContent);
         libraryDependenciesMeta[currentDependency].hasNoExports = dependencyContent.hasNoExports;
         result.add(dependencyContent);

         // add dependency content into dependencies cache. Needed for incremental build
         privatePartsForCache.push(dependencyContent);
      }

      if (currentPrivateDependencies.length > 0) {
         await pMap(
            currentPrivateDependencies,
            async(childDependency) => {
               await dependencyWalker(
                  options,
                  sourceRoot,
                  outputRoot,
                  libraryName,
                  newDepTree,
                  currentDependency,
                  childDependency,
                  libraryDependenciesMeta,
                  externalDependenciesToPush,
                  privateModulesCache,
                  privatePartsForCache,
                  result,
                  dependenciesTreeError
               );
            },
            {
               concurrency: 10
            }
         );
      }
   } else {
      logger.error({
         message: `Cycle dependency detected: ${currentDependency}. Parent module: ${parentDependency}`,
         filePath: `${path.join(sourceRoot, libraryName)}.js`
      });

      dependenciesTreeError.type = 'cycle dependency';
   }
}

function getPrivateDependencies(sourceRoot, privateModulesCache, privatePartsForCache) {
   const result = [];

   privatePartsForCache.forEach((dependency) => {
      if (dependency.sourcePath) {
         result.push(dependency.sourcePath);
      } else {
         result.push(
            getSourcePathByModuleName(sourceRoot, privateModulesCache, dependency.moduleName)
         );
      }
   });

   return result;
}

async function recursiveAnalizeEntry(
   options,
   sourceRoot,
   outputRoot,
   libraryName,
   libraryDependenciesMeta,
   externalDependenciesToPush,
   privateDependencies,
   privateModulesCache,
   privatePartsForCache
) {
   const result = new Set();

   let startDate;
   if (libraryName === 'JitsiConference/app-react') {
      logger.info({
         message: 'начало чтения и анализа библиотеки и её приватных зависимостей',
         filePath: libraryName
      });
      startDate = Date.now();
   }

   /**
    * Не будем ругаться через throw, просто проставим флаг.
    * Это позволит нам полностью проанализировать граф и сразу
    * выдать разработчикам все проблемные места.
    */
   const dependenciesTreeError = { };

   await pMap(
      privateDependencies,
      async(dependency) => {
         const currentTreeSet = new Set();
         await dependencyWalker(
            options,
            sourceRoot,
            outputRoot,
            libraryName,
            currentTreeSet,

            // parent module
            libraryName,

            // current dependency
            dependency,
            libraryDependenciesMeta,
            externalDependenciesToPush,
            privateModulesCache,
            privatePartsForCache,
            result,
            dependenciesTreeError
         );
      }
   );

   if (dependenciesTreeError.type === 'external private module') {
      const currentError = new Error('external private module use detected. See logs.\n');

      currentError.privateDependencies = getPrivateDependencies(sourceRoot, privateModulesCache, privatePartsForCache);

      throw currentError;
   }

   if (dependenciesTreeError.type === 'cycle dependency') {
      const currentError = new Error('Cycle dependencies detected. See logs.\n');

      currentError.privateDependencies = getPrivateDependencies(sourceRoot, privateModulesCache, privatePartsForCache);

      throw currentError;
   }

   if (libraryName === 'JitsiConference/app-react') {
      logger.info({
         message: `чтение и анализ библиотеки и её приватных зависимостей выполнено за ${(Date.now() - startDate) / 1000} секунд`,
         filePath: libraryName
      });
   }

   return result;
}

async function packLibrary(options, sourceRoot, outputRoot, data, privateModulesCache) {
   const startTime = Date.now();
   const privatePartsForCache = [];
   const libraryWarnings = [];
   const ast = parseCode(data);
   const {
      libraryDependencies,
      libraryDependenciesMeta,
      libraryParametersNames,
      functionCallbackBody,
      topLevelReturnStatement,
      exportsDefine,
      libraryName
   } = libPackHelpers.getLibraryMeta(ast);
   const externalDependenciesToPush = [];
   const privateDependenciesSet = Object.keys(libraryDependenciesMeta).filter(
      dependency => libraryDependenciesMeta[dependency].isPrivate
   );

   /**
    * рекурсивно по дереву получаем полный набор приватных частей библиотеки,
    * от которых она зависит.
    *
    * сортируем приватные модули между собой, наиболее зависимые от других приватных частей модули
    * будут обьявляться в самом конце, самые независимые вначале.
    */
   const privateDependenciesOrder = libPackHelpers.sortPrivateModulesByDependencies([
      ...await recursiveAnalizeEntry(
         options,
         sourceRoot,
         outputRoot,
         libraryName,
         libraryDependenciesMeta,
         externalDependenciesToPush,
         privateDependenciesSet,
         privateModulesCache,
         privatePartsForCache
      )
   ], libraryName);

   return {
      ...generateLibrary(ast, {
         externalDependenciesToPush,
         libraryDependencies,
         libraryParametersNames,
         functionCallbackBody,
         topLevelReturnStatement,
         exportsDefine,
         libraryDependenciesMeta,
         sourceRoot,
         libraryName,
         privateDependenciesOrder,
         privatePartsForCache,
         privateModulesCache
      }, libraryWarnings),
      timestamp: {
         start: startTime,
         finish: Date.now()
      }
   };
}

module.exports = packLibrary;
