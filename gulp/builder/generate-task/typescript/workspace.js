'use strict';

const fs = require('fs-extra');
const { path, cwd } = require('../../../../lib/platform/path');
const createConfig = require('./configuration');
const assert = require('assert');
const hooks = require('../../../common/classes/hooks').hooks();
const logger = require('../../../../lib/logger').logger();
const getBuildStatusStorage = require('../../../common/classes/build-status');
const PROJECT_REFERENCES_MODULES = require('./project-references-modules');
const getMetricsReporter = require('../../../common/classes/metrics-reporter');

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

async function removeDropCache(taskParameters, currentTsConfig, configPath, projectReferences) {
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
            getMetricsReporter().onCacheDrop('tsc', reason);
            await hooks.executeHook('dropCacheHook', ['tsc', reason]);
         }
         await removeCurrentCache(taskParameters);
      }
   }

   // В случае, если кеш-файл существует, а output директории нет,
   // необходимо удалить кеш-файл
   // у project references кеш работает по умолчанию и встроен в проект без отдельного хеш-файла, поэтому
   // данную проверку не используем.
   const cacheExists = (await fs.pathExists(taskParameters.config.tscCachePath)) || projectReferences;
   const outputExists = await fs.pathExists(taskParameters.config.typescriptOutputDir);
   const lockFileExists = await fs.pathExists(taskParameters.config.tscCacheLockFile);
   const featureFileExists = await fs.pathExists(taskParameters.config.tscCacheFeatureFile);

   if (!cacheExists) {
      getMetricsReporter().typescriptCacheExists = false;
   }

   if (xor(cacheExists, outputExists) || lockFileExists || !featureFileExists) {
      await removeCurrentCache(taskParameters);
   }

   // временный файл, нужен чтобы перейти глобально на project references и везде обновить кеш tsc.
   if (!featureFileExists) {
      const reason = 'Не найден feature с предыдущей компиляции tsc для данного набора модулей. Кеш tsc будет удалён.';
      logger.info(reason);
      taskParameters.cache.dropCacheForTsc = true;
   }

   if (lockFileExists) {
      const reason = 'Найден lockfile с предыдущей компиляции tsc для данного набора модулей. Кеш tsc будет удалён.';
      logger.info(reason);
      taskParameters.cache.dropCacheForTsc = true;

      if (!getBuildStatusStorage().cacheIsDropped) {
         getMetricsReporter().onCacheDrop('tsc', reason);
         await hooks.executeHook('dropCacheHook', ['tsc', reason]);
      }
   }
}

function prepare(taskParameters, excludeModulesList = [], projectReferences) {
   return async function prepareTypescriptWorkspace() {
      if (taskParameters.cache.hasTypescriptErrors()) {
         const failedModules = taskParameters.cache.failedTypescriptModules;

         logger.info(`${failedModules.length > 1 ? 'В модулях' : 'В модуле'} ${failedModules.join(', ')} обнаружены ошибки компиляции TypeScript с предыдущей сборки. tsc компилятор будет запущен для пересборки`);
         taskParameters.config.typescriptChanged = true;
      }

      taskParameters.config.setExcludeModulesList(excludeModulesList);

      if (projectReferences) {
         taskParameters.config.setProjectReferencesList(PROJECT_REFERENCES_MODULES);
      }

      if (excludeModulesList.length > 0) {
         logger.debug(`count of excluded modules: ${excludeModulesList.length}`);
      }

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
         // при сборке через project references задаём путь до кеша только для модулей из этой
         // группы, для остальных модулей директория установится автоматически при запуске tsc
         // в обычном режиме.
         if (!moduleInfo.typescriptOutputDir) {
            if (projectReferences && !PROJECT_REFERENCES_MODULES.includes(moduleInfo.name)) {
               return;
            }
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

      // при сборке через project references не должно быть указаний типов для юнит-тестов
      // это приведёт к ошибке.
      // TODO обсудить с Зайцевым этот момент, возможно надо будет выпилить из tsconfig и указывать
      //  данные типы только при сборке юнит-тестов
      if (projectReferences) {
         config.compilerOptions.types = config.compilerOptions.types.filter(type => !['jest', 'mocha'].includes(type));
      }

      // готовим проект для компиляции в отдельной директории для tsc,
      // за исключением модулей, которые были исключены из работы tsc
      // в настройках сборки.
      taskParameters.config.modules.forEach((moduleInfo) => {
         if (excludeModulesList.includes(moduleInfo.name)) {
            return;
         }

         const newPath = path.join(taskParameters.config.tscDirectory, moduleInfo.name);

         if (projectReferences) {
            // при сборке через project references нужно вычистить из конфига все лишние модули, которые
            // не участвуют в сборке
            if (!PROJECT_REFERENCES_MODULES.includes(moduleInfo.name)) {
               delete config.compilerOptions.paths[`${moduleInfo.name}/*`];
               return;
            }

            // мы не можем симличить исходники, в них перед работой project references
            // нам необходимо разместить помодульные tsconfig.json с указанием соответствующих
            // настроек для project references
            // TODO это временное решение, нужно в репозитории для таких модулей разместить tsconfig.json
            fs.copySync(moduleInfo.path, newPath, { dereference: true });

            // в основном tsconfig нужно прописать в references все модули проекта, которые будут собираться
            // на project references
            if (!config.references) {
               config.references = [];
            }
            config.references.push({ path: `./${moduleInfo.name}` });

            const currentModuleTsConfig = {
               extends: '../tsconfig.base.json',
               compilerOptions: {
                  composite: true
               },
               include: [
                  '**/*',
                  '../wasabyGlobalTypings.d.ts'
               ]

            };

            // в помодульном tsconfig нужно прописать в references все модули, от которых зависит
            // ts-код данного проекта. Для project references это является зависимостью и при
            // инкрементальной сборке tsc будет пересобирать код зависимостей только если он менялся.
            moduleInfo.depends.forEach((dependency) => {
               // не надо добавлять ссылки на модули, которые не включены в сборку через
               // project references, это приведёт к ошибке.
               if (!PROJECT_REFERENCES_MODULES.includes(dependency)) {
                  return;
               }

               if (!currentModuleTsConfig.references) {
                  currentModuleTsConfig.references = [];
               }

               currentModuleTsConfig.references.push({ path: `../${dependency}` });
            });

            fs.outputJsonSync(
               path.join(taskParameters.config.tscDirectory, moduleInfo.name, 'tsconfig.json'),
               currentModuleTsConfig
            );
         } else {
            // для модулей, которые собирались через project references, надо в текущий конфиг передать путь до
            // скомпиленных .d.ts файлов(в дополнение к исходникам) и не компилировать их в текущем наборе модулей.
            if (PROJECT_REFERENCES_MODULES.includes(moduleInfo.name)) {
               config.compilerOptions.paths[`${moduleInfo.name}/*`] = [
                  path.join(moduleInfo.typescriptOutputDir, moduleInfo.name, '*')
               ];
               return;
            }
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
         }
      });

      excludeModulesList.forEach((currentModule) => {
         delete config.compilerOptions.paths[`${currentModule}/*`];
      });

      if (projectReferences) {
         // при использовании project references в конревом конфиге должны быть только перечислены
         // проекты-модули, а уже внутри них будут прописаны пути до всех необходимых файлов, которые
         // необходимо скомпилировать в js-код и описание типов. Это необходимо, чтобы компиляция была
         // помодульной
         config.include = [];
         config.compilerOptions.skipLibCheck = true;
      } else {
         // нужно указать в tsconfig путь до глобальных типов, чтобы tsc компилятор
         // понимал, откуда их брать. Нужно для грамотного тайпчекинга зависимостей
         // с использованием плагинов requirejs
         config.include = [
            '**/*',
            '../wasabyGlobalTypings.d.ts'
         ];
      }

      // проверяем, изменился ли tsconfig с момента последней сборки
      await removeDropCache(taskParameters, config, configPath, projectReferences);

      // save current tsconfig in tsc cache to compare it in further builds
      await fs.outputJson(configPath, config);

      // в случае со сборкой через project references должно быть 2 tsconfig:
      // 1) корневой базовый tsconfig(tsconfig.base.json), в нём описываются все опции компилятора
      // и данный конфиг используют все помодульные tsconfig
      // 2) корневой конфиг(tsconfig.json). Данный конфиг никак не используется в помодульных tsconfig,
      // в нём описан только список этих подпроектов, которые надо скомпилировать компилятору через
      // project references
      if (projectReferences) {
         const baseTSConfigPath = taskParameters.typescriptConfigPath.replace('.json', '.base.json');
         const baseConfig = { ...config };
         delete baseConfig.references;
         baseConfig.compilerOptions.rootDir = '.';

         await fs.outputFile(
            baseTSConfigPath,
            JSON.stringify(baseConfig, null, 3)
         );

         delete config.compilerOptions;
         delete config.extends;
         config.files = [];
      }

      await fs.outputFile(
         taskParameters.typescriptConfigPath,
         JSON.stringify(config, null, 3)
      );

      await fs.ensureSymlink(
         path.join(taskParameters.sabyTypescriptDir, 'tslib.d.ts'),
         path.join(taskParameters.config.tscDirectory, 'tslib.d.ts')
      );

      // нам необходимо добавить в корень проекта описание глобальных типов, чтобы работали
      // плагины requirejs
      // Делаем это только для мини проекта с project references, пока модуль WS.Core не будет
      // переведён на работу в этой схеме
      if (projectReferences) {
         await fs.ensureSymlink(
            path.join(taskParameters.sabyTypescriptDir, 'wasabyGlobalTypings.d.ts'),
            path.join(taskParameters.config.tscDirectory, 'wasabyGlobalTypings.d.ts')
         );
      }

      /**
       * symlink also node_modules from builder to current project.
       * tsconfig requires types definition module(node_modules/@types) to be defined in current project node_modules.
       */
      await fs.ensureSymlink(
         path.dirname(taskParameters.sabyTypescriptDir),
         path.join(taskParameters.config.tscDirectory, 'node_modules')
      );

      try {
         const additionalTypesPath = path.join(taskParameters.config.sourcesDirectory, 'Typescript/types');

         if (await fs.pathExists(additionalTypesPath)) {
            const typesToSymlink = await fs.readdir(additionalTypesPath);

            for (const typePath of typesToSymlink) {
               // симличим типы для pixi и pixi-react в глобальный неймспейс типов для tsc компилятора
               // eslint-disable-next-line no-await-in-loop
               await fs.ensureSymlink(
                  path.join(taskParameters.config.sourcesDirectory, `Typescript/types/${typePath}`),
                  path.join(taskParameters.config.tscDirectory, `node_modules/@types/${typePath}`)
               );
            }
         }
      } catch (error) {
         logger.warning({
            message: `Не смогли засимличить пути до библиотек pixi и pixi-react в ${path.join(taskParameters.config.tscDirectory, 'node_modules', '@types')}`,
            error
         });
      }


      await fs.outputFile(taskParameters.config.tscCacheLockFile, '');
      await fs.outputFile(taskParameters.config.tscCacheFeatureFile, '');
   };
}
function clean(taskParameters) {
   return async function cleanTypescriptWorkspace() {
      if (!taskParameters.config.typescriptChanged && !taskParameters.cache.isFirstBuild()) {
         taskParameters.config.deleteProjectReferencesList();
         return;
      }

      await fs.remove(taskParameters.config.tscDirectory);
      await fs.remove(taskParameters.config.tscCacheLockFile);

      // нужно убрать список модулей на project references, чтобы при
      // последующем запуске tsc для оставшейся группы модулей сгенерировался
      // отдельный хеш
      taskParameters.config.deleteProjectReferencesList();
      delete taskParameters.sabyTypescriptDir;
   };
}

module.exports = {
   prepare,
   clean
};
