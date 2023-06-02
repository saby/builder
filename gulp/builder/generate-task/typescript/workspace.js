'use strict';

const fs = require('fs-extra');
const { path, cwd } = require('../../../../lib/platform/path');
const createConfig = require('./configuration');
const assert = require('assert');
const hooks = require('../../../common/classes/hooks').hooks();
const logger = require('../../../../lib/logger').logger();
const getBuildStatusStorage = require('../../../common/classes/build-status');
const pMap = require('p-map');
const MODULES_WITH_ES5_CODE = [
   'Types/_deferred/Deferred',
   'Types/_deferred/DeferredCanceledError',
   'Types/_entity/applied/CancelablePromise'
];

async function getTypescriptDirectory() {
   if (await fs.pathExists(path.join(cwd(), '../saby-typescript'))) {
      return path.join(cwd(), '../saby-typescript');
   }

   return path.join(cwd(), 'node_modules/saby-typescript');
}

function xor(a, b) {
   return (!a && b) || (a && !b);
}

async function processFilesWithES5Extension(sourcesDirectory) {
   await pMap(
      MODULES_WITH_ES5_CODE,
      async(moduleWithES5Extension) => {
         const sourcePath = `${path.join(sourcesDirectory, moduleWithES5Extension)}.ts`;
         if (await fs.pathExists(`${sourcePath}.es5`)) {
            await fs.remove(sourcePath);
            await fs.move(`${sourcePath}.es5`, sourcePath);
         }
      }
   );
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
         await fs.promises.rm(taskParameters.config.tscCachePath, { force: true, recursive: true });
         await fs.promises.rm(taskParameters.typescriptOutputDir, { force: true, recursive: true });
      }
   }

   // В случае, если кеш-файл существует, а output директории нет,
   // необходимо удалить кеш-файл
   const cacheExists = await fs.pathExists(taskParameters.config.tscCachePath);
   const outputExists = await fs.pathExists(taskParameters.typescriptOutputDir);

   if (xor(cacheExists, outputExists)) {
      await fs.promises.rm(taskParameters.config.tscCachePath, { force: true, recursive: true });
      await fs.promises.rm(taskParameters.typescriptOutputDir, { force: true, recursive: true });
   }
}

function prepare(taskParameters) {
   return async function prepareTypescriptWorkspace() {
      taskParameters.sabyTypescriptDir = await getTypescriptDirectory();
      taskParameters.typescriptOutputDir = path.join(
         path.dirname(taskParameters.config.tscCachePath),
         'emit'
      );
      taskParameters.typescriptConfigPath = path.join(
         taskParameters.config.sourcesDirectory,
         'tsconfig.json'
      );

      const config = createConfig(taskParameters);
      const configPath = path.join(
         path.dirname(taskParameters.config.tscCachePath),
         'tsconfig.json'
      );

      // При сборке в ES5 спецификации надо заменить .ts на .ts.es5 файлы из-за
      // несовместимости кода Deferred в ES5 и ES6 спецификациях.
      // В ES6 спецификации в конструкторе требуется вызов super, что в ES5
      // спецификации превращается в невалидный код, а в случае с Deferred переписать
      // код на наследование не получится, поскольку это дженерик и мы сломаем типы
      // https://github.com/microsoft/TypeScript/issues/15202.
      // Решением данной проблемы пока стало наличие 2 версий файла - .ts по дефолту
      // и .ts.es5 для сборки при ESVersion = 5
      if (taskParameters.config.ESVersion === 5) {
         await processFilesWithES5Extension(taskParameters.config.sourcesDirectory);
      }

      await removeDropCache(taskParameters, config, configPath);

      // save current tsconfig in tsc cache to compare it in further builds
      await fs.outputJson(configPath, config);

      await fs.outputFile(
         taskParameters.typescriptConfigPath,
         JSON.stringify(config, null, 3)
      );

      await fs.ensureSymlink(
         path.join(taskParameters.sabyTypescriptDir, 'tslib.d.ts'),
         path.join(taskParameters.config.sourcesDirectory, 'tslib.d.ts')
      );

      /**
       * symlink also node_modules from builder to current project.
       * tsconfig requires types definition module(node_modules/@types) to be defined in current project node_modules.
       */
      await fs.ensureSymlink(
         path.dirname(taskParameters.sabyTypescriptDir),
         path.join(taskParameters.config.sourcesDirectory, 'node_modules')
      );
   };
}

function clean(taskParameters) {
   return async function cleanTypescriptWorkspace() {
      await fs.unlink(path.join(taskParameters.config.sourcesDirectory, 'tslib.d.ts'));
      await fs.unlink(path.join(taskParameters.config.sourcesDirectory, 'node_modules'));

      delete taskParameters.sabyTypescriptDir;
   };
}

module.exports = {
   prepare,
   clean
};
