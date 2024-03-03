'use strict';

const fs = require('fs-extra');
const { path, cwd } = require('../../../../lib/platform/path');
const createConfig = require('./configuration');
const assert = require('assert');
const hooks = require('../../../common/classes/hooks').hooks();
const logger = require('../../../../lib/logger').logger();
const getBuildStatusStorage = require('../../../common/classes/build-status');

async function getTypescriptDirectory() {
   if (await fs.pathExists(path.join(cwd(), '../saby-typescript'))) {
      return path.join(cwd(), '../saby-typescript');
   }

   return path.join(cwd(), 'node_modules/saby-typescript');
}

function xor(a, b) {
   return (!a && b) || (a && !b);
}

async function removeCurrentCache(taskParameters) {
   await fs.promises.rm(taskParameters.config.tscCachePath, { force: true, recursive: true });
   await fs.promises.rm(taskParameters.config.typescriptOutputDir, { force: true, recursive: true });
}

async function removeDropCache(taskParameters, currentTsConfig, configPath) {
   if (!taskParameters.config.tscCache) {
      return;
   }

   if (await fs.pathExists(configPath)) {
      const previousTsConfig = await fs.readJson(configPath);
      try {
         assert.deepStrictEqual(previousTsConfig, currentTsConfig);
      } catch (error) {
         const reason = 'Изменился tsconfig. Выполняем tsc с нуля';
         logger.info(reason);
         taskParameters.cache.dropCacheForTsc = true;

         // push tsc cache absence only if cache isn't dropped already
         if (!getBuildStatusStorage().cacheIsDropped) {
            await hooks.executeHook('dropCacheHook', ['tsc', reason]);
         }
         await removeCurrentCache(taskParameters);
      }
   }

   // В случае, если кеш-файл существует, а output директории нет,
   // необходимо удалить кеш-файл
   const cacheExists = await fs.pathExists(taskParameters.config.tscCachePath);
   const outputExists = await fs.pathExists(taskParameters.config.typescriptOutputDir);
   const lockFileExists = await fs.pathExists(taskParameters.config.tscCacheLockFile);

   if (xor(cacheExists, outputExists) || lockFileExists) {
      await removeCurrentCache(taskParameters);
   }

   if (lockFileExists) {
      const reason = 'Найден lockfile с предыдущей компиляции tsc для данного набора модулей. Кеш tsc будет удалён.';
      logger.info(reason);
      taskParameters.cache.dropCacheForTsc = true;

      if (!getBuildStatusStorage().cacheIsDropped) {
         await hooks.executeHook('dropCacheHook', ['tsc', reason]);
      }
   }
}

function prepare(taskParameters, excludeModulesList = []) {
   return async function prepareTypescriptWorkspace() {
      if (taskParameters.cache.hasTypescriptErrors()) {
         const failedModules = taskParameters.cache.failedTypescriptModules;

         logger.info(`${failedModules.length > 1 ? 'В модулях' : 'В модуле'} ${failedModules.join(', ')} обнаружены ошибки компиляции TypeScript с предыдущей сборки. tsc компилятор будет запущен для пересборки`);
         taskParameters.config.typescriptChanged = true;
      }

      taskParameters.config.setExcludeModulesList(excludeModulesList);
      logger.debug(`count of excluded modules: ${excludeModulesList.length}`);
      taskParameters.sabyTypescriptDir = await getTypescriptDirectory();
      taskParameters.typescriptConfigPath = path.join(
         taskParameters.config.tscDirectory,
         'tsconfig.json'
      );

      taskParameters.config.modules.forEach((moduleInfo) => {
         if (excludeModulesList.includes(moduleInfo.name)) {
            return;
         }

         // задаём директорию tsc выхлопа именно в самом модуле, потому что в сборке
         // online-inside есть 2 независимых кеша и выхлопа tsc для каждой из подгрупп
         // интерфейсных модулей.
         if (!moduleInfo.typescriptOutputDir) {
            moduleInfo.typescriptOutputDir = taskParameters.config.typescriptOutputDir;
         }
      });


      if (!taskParameters.config.typescriptChanged && !taskParameters.cache.isFirstBuild()) {
         logger.info('Пропускаем работу компилятора tsc, поскольку ts/tsx код не менялся с предыдущей сборки');
         return;
      }

      const config = createConfig(taskParameters);
      const configPath = path.join(
         path.dirname(taskParameters.config.tscCachePath),
         'tsconfig.json'
      );

      // готовим проект для компиляции в отдельной директории для tsc,
      // за исключением модулей, которые были исключены из работы tsc
      // в настройках сборки.
      taskParameters.config.modules.forEach((moduleInfo) => {
         if (excludeModulesList.includes(moduleInfo.name)) {
            return;
         }

         const newPath = path.join(taskParameters.config.tscDirectory, moduleInfo.name);
         try {
            fs.ensureSymlinkSync(moduleInfo.path, newPath, 'dir');
         } catch (err) {
            const errorMessage = 'An error occurred while creating symlink:\n' +
               `from: ${moduleInfo.path}\n` +
               `to: ${newPath}\n` +
               'Make sure you\'re running your CLI or IDE with administrator rules(or with sudo rules in linux)\n' +
               `Error: ${err.message}`;
            throw new Error(errorMessage);
         }
      });

      excludeModulesList.forEach((currentModule) => {
         delete config.compilerOptions.paths[`${currentModule}/*`];
      });

      await removeDropCache(taskParameters, config, configPath);

      // save current tsconfig in tsc cache to compare it in further builds
      await fs.outputJson(configPath, config);

      await fs.outputFile(
         taskParameters.typescriptConfigPath,
         JSON.stringify(config, null, 3)
      );

      await fs.ensureSymlink(
         path.join(taskParameters.sabyTypescriptDir, 'tslib.d.ts'),
         path.join(taskParameters.config.tscDirectory, 'tslib.d.ts')
      );

      /**
       * symlink also node_modules from builder to current project.
       * tsconfig requires types definition module(node_modules/@types) to be defined in current project node_modules.
       */
      await fs.ensureSymlink(
         path.dirname(taskParameters.sabyTypescriptDir),
         path.join(taskParameters.config.tscDirectory, 'node_modules')
      );

      await fs.outputFile(taskParameters.config.tscCacheLockFile, '');
   };
}

function clean(taskParameters) {
   return async function cleanTypescriptWorkspace() {
      if (!taskParameters.config.typescriptChanged) {
         return;
      }

      await fs.remove(taskParameters.config.tscDirectory);
      await fs.remove(taskParameters.config.tscCacheLockFile);

      delete taskParameters.sabyTypescriptDir;
   };
}

module.exports = {
   prepare,
   clean
};
