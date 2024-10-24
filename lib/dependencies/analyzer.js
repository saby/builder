/**
 * Модуль, предназначенный для анализа зависимостей собираемого проекта.
 * Выполняемые проверки включают:
 * 1) Поиск циклических зависимостей;
 * 2) Поиск несуществующих зависимостей;
 * 3) Поиск незадекларированных в s3mod файлах зависимостей интерфейсных модулей;
 *
 * @author Krylov M.A.
 */
'use strict';

const fs = require('fs-extra');

const Mapper = require('../struct/mapper');
const Digraph = require('../struct/digraph');

const transliterate = require('../transliterate');
const findMostSimilar = require('../levenshtein');
const { path } = require('../platform/path');
const { getPrettyPath, normalizeModuleName } = require('../modulepath-to-require');

const parseDependency = require('./rjs');

/**
 * Служебные зависимости AMD модуля.
 * @type {Set<string>}
 */
const ModuleParameters = new Set([
   'require',
   'module',
   'exports'
]);

/**
 * Список плагинов, на зависимости которых не стоит выводить диагностические сообщения,
 * если соответствующий файл существует на диске.
 * @type {string[]}
 */
const TrustedPlugins = ['css', 'json', 'text'];

/**
 * Проверить, является ли зависимость потенциальным Npm пакетом или Node.js модулем.
 * Такие зависимости не нужно обрабатывать.
 * <br>
 * Исключаем зависимости, которые:<br>
 * 1. Начинаются с @, например, @testing-library/user-event;<br>
 * 2. Начинаются с node:, например, node:path;<br>
 * 3. Не содержат /, например, path.
 * @param {RequireJSModule} module Проверяемая зависимость.
 * @return {boolean}
 */
function isPossiblyNpmPackageOrNodeModule(module) {
   return (
      module.name.startsWith('@') ||
      module.name.startsWith('node:') ||
      !module.name.includes('/')
   );
}

/**
 * Нормализовать RequireJS зависимость.
 * Здесь удаляются все избыточные плагины, не относящиеся к типу содержимого зависимости,
 * а все JSON зависимости приводятся к формату "json!<путь>.json".
 * @param {RequireJSModule} module Зависимость.
 * @return {RequireJSModule} Возвращает зависимость, в которой отсутствуют необязательные плагины.
 */
function normalizeModule(module) {
   const nModule = module.clone();

   if (nModule.name.endsWith('.json')) {
      nModule.addPlugin('json');
   }

   if (nModule.hasPlugin('json') && !nModule.name.endsWith('.json')) {
      nModule.name = `${nModule.name}.json`;
   }

   if (nModule.hasPlugin('native-css')) {
      nModule.addPlugin('css');

      nModule.deletePlugin('native-css');
   }

   nModule.deletePlugin('browser');
   nModule.deletePlugin('is');
   nModule.deletePlugin('js');
   nModule.deletePlugin('normalize');
   nModule.deletePlugin('optional');
   nModule.deletePlugin('order');
   nModule.deletePlugin('preload');

   return nModule;
}

/**
 * Создать карту модулей из списка конфигурации.
 * @param {ModuleInfo[]} modules Список модулей текущего проекта.
 * @return {Map<string, { name: string, depends: Set<string>, ref: ModuleInfo }>}
 */
function createModulesMap(modules) {
   const dict = modules.map(moduleInfo => [
      transliterate(moduleInfo.name),
      {
         name: moduleInfo.name,
         depends: new Set(),
         ref: moduleInfo
      }
   ]);

   return new Map(dict);
}

/**
 * Создать множество имен внешних интерфейсных модулей.
 * @param {string[]} externalModules Коллекция имен внешних модулей.
 * @returns {Set<string>} Множество имен внешних интерфейсных модулей.
 */
function createExternalsSet(externalModules) {
   const externalsSet = new Set();

   if (externalModules instanceof Array) {
      externalModules.forEach(name => externalsSet.add(transliterate(name)));
   }

   return externalsSet;
}

/**
 * Создать граф для анализа UI модулей.
 * @param {Map<string, { name: string, depends: Set<string>, ref: ModuleInfo }>} modulesMap Список модулей.
 * @return {Digraph} Граф зависимостей UI модулей.
 */
function createUIModulesGraph(modulesMap) {
   const graph = new Digraph(new Mapper());

   modulesMap.forEach((moduleInfo) => {
      // Удаляем связи с самим собой
      moduleInfo.depends.delete(moduleInfo.name);

      graph.put(moduleInfo.name, Array.from(new Set(moduleInfo.ref.depends)));
   });

   const lost = graph.testLostVertexes();

   for (const [uiModule] of lost) {
      // Добавляем зависимость, чтобы далее продолжить анализировать граф.
      graph.put(uiModule, []);
   }

   return graph;
}

/**
 * Проверить, существует ли файл, соответствующий зависимости.
 * @param {string} baseDir Корневая директория с интерфейсными модулями.
 * @param {RequireJSModule} module Обрабатываемая зависимость
 * @return {Promise<boolean>} Возвращает true, если для зависимости существует исходный файл.
 */
function moduleFileExists(baseDir, module) {
   const filePath = normalizeModuleName(module.name);

   if (module.plugins.size === 0) {
      return fs.pathExists(path.join(baseDir, `${filePath}.js`));
   }

   if (module.hasPlugin('css')) {
      return fs.pathExists(path.join(baseDir, `${filePath}.css`));
   }

   if (module.hasPlugin('wml')) {
      return fs.pathExists(path.join(baseDir, `${filePath}.wml`));
   }

   if (module.hasPlugin('tmpl')) {
      return fs.pathExists(path.join(baseDir, `${filePath}.tmpl`));
   }

   if (module.hasPlugin('html')) {
      return fs.pathExists(path.join(baseDir, `${filePath}.xhtml`));
   }

   if (module.hasPlugin('font')) {
      // Зависимость вида font!Module/file?size
      return fs.pathExists(path.join(baseDir, module.name.split('?').shift()));
   }

   return fs.pathExists(path.join(baseDir, filePath));
}

/**
 * Проверить, существует ли TypeScript файл, соответствующий зависимости.
 * @param {string} baseDir Корневая директория с интерфейсными модулями.
 * @param {RequireJSModule} module Обрабатываемая зависимость
 * @return {Promise<boolean>} Возвращает true, если для зависимости существует исходный файл.
 */
async function typeScriptFileExists(baseDir, module) {
   const filePath = normalizeModuleName(module.name);

   if (module.plugins.size !== 0) {
      return false;
   }

   if (filePath.endsWith('.d')) {
      return fs.pathExists(path.join(baseDir, `${filePath}.ts`));
   }

   if (await fs.pathExists(path.join(baseDir, `${filePath}.d.ts`))) {
      return true;
   }

   if (await fs.pathExists(path.join(baseDir, `${filePath}.ts`))) {
      return true;
   }

   return fs.pathExists(path.join(baseDir, `${filePath}.tsx`));
}

/**
 * Безопасно прочитать файл.
 * @param {string} filePath Путь до файла.
 * @param {Function} callback Функция-обработчик JSON файла.
 * @return {Promise<void>}
 */
async function withJsonFile(filePath, callback) {
   if (!(await fs.pathExists(filePath))) {
      return;
   }

   const json = await fs.readJSON(filePath);

   const result = callback(json);

   if (result instanceof Promise) {
      await result;
   }
}

/**
 * Получить инстанс ModuleInfo для какой-нибудь зависимости из списка.
 * @param {Map<string, { name: string, depends: Set<string>, ref: ModuleInfo }>} modulesMap
 * Коллекция обрабатываемых модулей проекта.
 * @param {string[]} sources Список зафисимостей.
 * @returns {string | null} Возвращает инстанс ModuleInfo, если таковой был найден.
 */
function findModuleInfoWithSources(modulesMap, sources) {
   for (const source of sources) {
      const module = parseDependency(source);

      if (modulesMap.has(module.uiName)) {
         return module.uiName;
      }
   }

   return null;
}

/**
 * Функция, выполняющая фильтрацию исходных файлов.
 * Используется для отображаения списка проблемных файлов, в котором не все файлы нужно отображать.
 * @param {string} sourceFile Путь до исходного файла.
 * @return {boolean} Возвращает true, если исходный файл необходимо оставить в списке.
 */
function filterSourceFile(sourceFile) {
   if (sourceFile.includes('/third-party/')) {
      // Исключаем third-party файлы
      return false;
   }

   // Исключаем TypeScript файлы
   // Для этих случаев мы публикуем сообщения самого компилятора (TS2307)
   return !(
      sourceFile.endsWith('.ts') || sourceFile.endsWith('.tsx')
   );
}

class Analyzer {
   /**
    * Инициализировать новый инстанс.
    * @param {WriteStream} stream Поток, в который выводятся логи.
    * @param {ModuleInfo[]} modules Коллекция обрабатываемых модулей.
    * @param {string[]} externalModules Коллекция имен внешних модулей.
    */
   constructor(stream, modules, externalModules) {
      this.stream = stream;

      /**
       * Отображение имени модуля в путь до файла.
       * Имена некоторых модулей не являются прямым отображением в путь до файла.
       * Для удобства анализа ошибки, пользователям выводятся диагностические ошибки
       * со ссылками на исходные файлы.
       * @type {Map<string, string>}
       */
      this.files = new Map();

      /**
       * Граф зависимостей проекта.
       * Необходим для анализа неопределенных модулей и циклических зависимостей.
       * @type {Digraph}
       */
      this.graph = new Digraph(new Mapper());

      /**
       * Коллекция обрабатываемых модулей проекта.
       * @type {Map<string, { name: string, depends: Set<string>, ref: ModuleInfo }>}
       */
      this.modulesMap = createModulesMap(modules);

      /**
       * Множество внешних модулей проекта, которые не существуют физически.
       * @type {Set<string>}
       */
      this.externalsSet = createExternalsSet(externalModules);

      /**
       * Множество имен псевдоинтерфейсных модулей third-party модулей,
       * которые существуют и легально находятся в проекте, но мешают анализу зависимостей.
       * @type {Set<string>}
       */
      this.thirdParty = new Set();

      /**
       * Множество библиотек проекта.
       * @type {Set<string>}
       */
      this.libraries = new Set();

      /**
       * Коллекция диагностических сообщений, подлежащих выводу.
       * @type {{ kind: string, message: string, module: string }[]}
       */
      this.diagnosticMessages = [];
   }

   /**
    * Загрузить служебные артефакты, необходимые для анализа зависимостей.
    * @param {string} baseDir Корневая директория с интерфейсными модулями.
    * @return {Promise<void[]>}
    */
   load(baseDir) {
      const modules = Array.from(this.modulesMap.values());
      const handler = this._loadModuleArtifacts.bind(this, baseDir);

      return Promise.all(modules.map(handler));
   }

   /**
    * Проверить граф зависимостей на несуществующие зависимости.
    * @param {string} baseDir Корневая директория с интерфейсными модулями.
    */
   async testLostDependencies(baseDir) {
      const lost = this.graph.testLostVertexes();

      for await (const [rawModule, sources] of lost) {
         // Добавляем зависимость, чтобы далее продолжить анализировать граф.
         this.graph.put(rawModule, []);

         const module = parseDependency(rawModule);
         const filteredSources = sources
            .map(this.files.get.bind(this.files))
            .filter(filterSourceFile);
         const sourcesStr = filteredSources
            .map(filePath => `\t* ${filePath}`)
            .join('\n');

         if (module.name.includes('/third-party/') || sourcesStr === '') {
            // Не обрабатываем файлы, лежащие в директории third-party.
            this.stream.write(`[DEBUG] Игнорируем потерянную third-party зависимость ${rawModule}, указанную в файлах:\n${sourcesStr}\n`);

            continue;
         }

         if (this.externalsSet.has(module.uiName)) {
            // Не обрабатываем файлы, которые ссылаются на внешние интерфейсные модули.
            this.stream.write(`[DEBUG] Обнаружена зависимость ${rawModule} на внешний интерфейсный модуль ${module.uiName}, указанная в файлах:\n${sourcesStr}\n`);

            continue;
         }

         if (!this.modulesMap.has(module.uiName)) {
            let mostSimilarHint = '';

            const possibleUiModule = findMostSimilar(module.uiName, Array.from(this.modulesMap.keys()), 3);

            if (possibleUiModule) {
               mostSimilarHint = ` (имеется в виду модуль ${possibleUiModule}?)`;
            }

            this.diagnosticMessages.push({
               kind: 'warning',
               message: `В проекте не существует интерфейсный модуль ${module.uiName}${mostSimilarHint}, на который ссылается зависимость ${rawModule}, указанная в файлах: ${filteredSources.join(', ')}`,
               module: findModuleInfoWithSources(this.modulesMap, filteredSources)
            });

            continue;
         }

         if (await moduleFileExists(baseDir, module)) {
            if (TrustedPlugins.some(plugin => module.plugins.has(plugin))) {
               // Зависимость существует на диске,
               // значит мы обработали ее не регистрируя в input-paths или components-info.
               continue;
            }

            this.stream.write(`[DEBUG] Не удалось найти информацию для зависимости ${rawModule}, указанной в файлах:\n${sourcesStr}.\n`);

            continue;
         }

         if (await typeScriptFileExists(baseDir, module)) {
            this.diagnosticMessages.push({
               kind: 'warning',
               message: `В проекте не найден JavaScript файл для соответствующего исходого TypeScript файла зависимости ${rawModule}, указанной в файлах: ${filteredSources.join(', ')}`,
               module: module.uiName
            });

            continue;
         }

         this.diagnosticMessages.push({
            kind: 'warning',
            message: `В проекте не существует файл для зависимости ${rawModule}, указанной в файлах: ${filteredSources.join(', ')}`,
            module: module.uiName
         });
      }
   }

   /**
    * Проверить граф на наличие циклических зависимостей.
    */
   testCycles() {
      this.graph.testCycles((cyclePath) => {
         const prettyPath = this._transformCyclePath(cyclePath);

         prettyPath.push(prettyPath[0]);

         this.diagnosticMessages.push({
            kind: 'warning',
            message: `В проекте обнаружена циклическая зависимость между файлами: ${prettyPath.join(' -> ')}`,
            module: findModuleInfoWithSources(this.modulesMap, prettyPath)
         });
      });
   }

   /**
    * Проверить граф зависимостей интерфейсных модулей на наличие зависимостей,
    * которые не были описаны в соответствующем s3mod файле.
    */
   testUndeclaredUiDependencies() {
      this.modulesMap.forEach((moduleInfo) => {
         const undeclared = new Set();
         const unused = new Set();
         const declared = new Set(moduleInfo.ref.depends);

         const actual = new Set(
            Array.from(moduleInfo.depends)
               .filter(this.modulesMap.has.bind(this.modulesMap))
         );

         // Удаляем связи с самим собой
         actual.delete(moduleInfo.name);

         actual.forEach(value => (declared.has(value) ? undefined : undeclared.add(value)));
         declared.forEach(value => (actual.has(value) ? undefined : unused.add(value)));

         if (unused.size > 0) {
            const sourcesStr = Array.from(unused)
               .map(name => `\t* ${name}${this.modulesMap.has(name) ? ` (${this.modulesMap.get(name).ref.id})` : ''}`)
               .join('\n');

            // TODO: проверить. возможно, потребуются доработки
            this.stream.write(`[DEBUG] В описании интерфейсного модуля ${moduleInfo.name}.s3mod содержатся неиспользуемые зависимости на другие модули:\n${sourcesStr}\n`);
         }

         if (undeclared.size > 0) {
            const sourcesStr = Array.from(undeclared)
               .map(name => `\t* ${name}${this.modulesMap.has(name) ? ` (${this.modulesMap.get(name).ref.id})` : ''}`)
               .join('\n');

            this.stream.write(`[ERROR] В описании интерфейсного модуля ${moduleInfo.name}.s3mod не хватает зависимостей на другие модули:\n${sourcesStr}\n`);
         }
      });
   }

   /**
    * Проверить граф зависимостей интерфейсных модулей на наличие циклических зависимостей.
    */
   testUiCycles() {
      const graph = createUIModulesGraph(this.modulesMap);

      graph.testCycles((cyclePath) => {
         const prettyCyclePath = [...cyclePath, cyclePath[0]];

         this.stream.write(`[ERROR] В проекте обнаружена циклическая зависимость между интерфейсными модулями:\n${prettyCyclePath.map(v => `\t-> ${v}`).join('\n')}\n`);
      });
   }

   /**
    * Сериализовать состояние анализатора.
    * @return {object}
    */
   toJSON() {
      return {
         class: 'Analyzer',
         state: {
            files: Array.from(this.files),
            graph: this.graph,
            modulesMap: Array.from(this.modulesMap),
            externalsSet: Array.from(this.externalsSet),
            thirdParty: Array.from(this.thirdParty),
            libraries: Array.from(this.libraries)
         }
      };
   }

   /**
    * Загрузить необходимые артефакты для модуля.
    * @param {string} baseDir Корневая директория с интерфейсными модулями.
    * @param {ModuleInfo} moduleInfo Обрабатываемый модуль.
    * @return {Promise<void>}
    */
   async _loadModuleArtifacts(baseDir, moduleInfo) {
      const componentsArtifactPath = path.join(baseDir, moduleInfo.name, '.cache', 'components-info.json');

      await withJsonFile(componentsArtifactPath, (json) => {
         this._putComponentDependencies(json);
         this._putMarkupDependencies(json);
      });

      const inputFilesArtifactPath = path.join(baseDir, moduleInfo.name, '.cache', 'input-paths.json');

      await withJsonFile(inputFilesArtifactPath, (json) => {
         this._putInputFiles(json);
      });

      const dependenciesArtifactPath = path.join(baseDir, moduleInfo.name, '.cache', 'dependencies.json');

      await withJsonFile(dependenciesArtifactPath, (json) => {
         this._putDependencies(json, moduleInfo);
      });
   }

   /**
    * Обработать JS компоненты артефакта components-info.json.
    * @param {object} json Содержимое артефакта.
    */
   _putComponentDependencies(json) {
      if (json.hasOwnProperty('componentsInfo')) {
         for (const fPath in json.componentsInfo) {
            if (json.componentsInfo.hasOwnProperty(fPath)) {
               const componentsInfoElement = json.componentsInfo[fPath];

               if (!componentsInfoElement.hasOwnProperty('componentName')) {
                  this.stream.write(`[DEBUG] Файл ${fPath} не содержит информацию о компоненте\n`);

                  this._putModule(fPath, fPath.replace(/\.[tj]sx?$/gi, ''), []);

                  continue;
               }

               try {
                  if (componentsInfoElement.hasOwnProperty('libraryName')) {
                     // Обрабатываем библиотеку. Необходимо смотреть в реальные зависимости модуля.
                     this.libraries.add(componentsInfoElement.componentName);
                  }

                  this._putModule(fPath, componentsInfoElement.componentName, componentsInfoElement.componentDep);
               } catch (error) {
                  // Сюда попадают кейсы, например, с реактом:
                  // когда один и тот же модуль в разных файлах (debug, release).
                  // Не ошибка, но на всякий случай полезная информация для нас.
                  this.stream.write(`[DEBUG] Ошибка при обработке componentsInfo.\n\tФайл: ${fPath}\n\tОшибка: ${error.message}\n`);
               }
            }
         }
      }
   }

   /**
    * Обработать шаблоны артефакта components-info.json.
    * @param {object} json Содержимое артефакта.
    */
   _putMarkupDependencies(json) {
      if (json.hasOwnProperty('markupCache')) {
         for (const fPath in json.markupCache) {
            if (json.markupCache.hasOwnProperty(fPath)) {
               const markupCacheElement = json.markupCache[fPath];

               try {
                  this._putModule(fPath, markupCacheElement.nodeName, markupCacheElement.dependencies);
               } catch (error) {
                  // Сюда попадают кейсы:
                  // когда один и тот же модуль в разных файлах (debug, release).
                  // Не ошибка, но на всякий случай полезная информация для нас.
                  this.stream.write(`[DEBUG] Ошибка при обработке markupCache.\n\tФайл: ${fPath}\n\tОшибка: ${error.message}\n`);
               }
            }
         }
      }
   }

   /**
    * Обработать файлы артефакта input-paths.json.
    * @param {object} json Содержимое артефакта.
    */
   _putInputFiles(json) {
      for (const filePath in json.paths) {
         if (json.paths.hasOwnProperty(filePath)) {
            const prettyFilePath = transliterate(getPrettyPath(filePath));

            if (filePath.endsWith('.json')) {
               // Добавляем JSON зависимости, которые отсутствуют в components-info.json
               const moduleName = `json!${prettyFilePath}`;

               this._putModule(filePath, moduleName, []);

               continue;
            }

            if (filePath.endsWith('.less') || filePath.endsWith('.css')) {
               if (json.paths[filePath].output.some(f => f.endsWith('.css'))) {
                  // Добавляем CSS зависимости, которые отсутствуют в components-info.json
                  const moduleName = `css!${prettyFilePath.replace(/\.(less|css)$/gi, '')}`;

                  this._putModule(filePath, moduleName, []);
               }
            }
         }
      }
   }

   /**
    * Обработать файлы артефакта dependencies.json.
    * @param {object} json Содержимое артефакта.
    * @param {object} moduleInfo Обрабатываемый модуль.
    * @private
    */
   _putDependencies(json, moduleInfo) {
      const lessDepends = new Set();

      for (const filePath in json) {
         if (json.hasOwnProperty(filePath)) {
            if (filePath.endsWith('.less')) {
               json[filePath].forEach((name) => {
                  lessDepends.add(transliterate(name.split('/').shift()));
               });
            }
         }
      }

      lessDepends.delete(moduleInfo.name);

      if (lessDepends.size > 0) {
         lessDepends.forEach(moduleInfo.depends.add.bind(moduleInfo.depends));

         this.stream.write(`[DEBUG] Зависимости по less для модуля ${moduleInfo.name}: ${Array.from(lessDepends).join(', ')}.\n`);
      }
   }

   /**
    * Добавить модуль в список анализируемых.
    * @param {string} filePath Путь до файла, соответствующий обрабатываемому модулю.
    * @param {string} moduleName Имя зависимости обрабатываемого модуля.
    * @param {string[]} dependencies Список зависимостей обрабатываемого модуля.
    */
   _putModule(filePath, moduleName, dependencies) {
      const source = parseDependency(moduleName);
      const children = [];

      this._updateThirdPartyCollection(filePath, source);

      for (const dependency of (dependencies || [])) {
         const target = parseDependency(dependency);

         if (!this._filterDependency(target)) {
            continue;
         }

         children.push(normalizeModule(target).raw);

         if (this.modulesMap.has(source.uiName)) {
            this.modulesMap.get(source.uiName).depends.add(target.uiName);
         }
      }

      this.graph.put(moduleName, children);
      this.files.set(moduleName, filePath);
   }

   /**
    * Определить необходимость обработки конкретной зависимости.
    * @param {RequireJSModule} module Обрабатываемая зависимость.
    * @returns {boolean} Возвращает true, если зависимость следует обработать.
    */
   _filterDependency(module) {
      // Порядок следования проверок важен!
      // Сначала более строгие проверки.

      if (ModuleParameters.has(module.name)) {
         // Не учитываем служебные зависимости модуля.
         return false;
      }

      if (this.thirdParty.has(module.uiName)) {
         // Не учитываем third-party зависимости.
         return false;
      }

      if (isPossiblyNpmPackageOrNodeModule(module)) {
         // В модулях могут быть зависимости на пользовательские Npm пакеты и Node.js модули.
         // Такие зависимости анализировать не нужно.
         return false;
      }

      if (module.hasPlugin('cdn') || module.name.startsWith('/cdn/')) {
         // Не анализируем CDN зависимости.
         return false;
      }

      if (module.hasPlugin('i18n') || module.hasPlugin('datasource')) {
         // Не учитываем некоторые зависимости.
         return false;
      }

      if (module.hasPlugin('json') || module.name.endsWith('.json')) {
         // Анализируем все JSON зависимости, за исключением lang.
         return true;
      }

      if (module.hasPlugin('optional')) {
         // Анализируем опциональные зависимости только в том случае,
         // если соответствующий интерфейсный модуль присутствует в проекте.
         return this.modulesMap.has(module.uiName);
      }

      return true;
   }

   /**
    * Обновить коллекцию third-party имен.
    * @param {string} filePath Путь до обрабатываемого файла.
    * @param {RequireJSModule} module Обрабатываемый модуль.
    */
   _updateThirdPartyCollection(filePath, module) {
      const uiFromFileName = filePath.split('/').shift();

      if (uiFromFileName !== module.uiName) {
         this.thirdParty.add(module.uiName);

         this.stream.write(`[DEBUG] В файле ${filePath} обнаружена third-party зависимость ${module.raw}\n`);
      }
   }

   /**
    * Трансформировать циклический путь так, чтобы он начинался с библиотеки.
    * @param {string[]} cyclePath Циклический путь.
    * @returns {string[]} cyclePath Циклический путь, который начинается с библиотеки.
    * @private
    */
   _transformCyclePath(cyclePath) {
      for (let i = 0; i < cyclePath.length; i++) {
         if (this.libraries.has(cyclePath[i])) {
            return [...cyclePath.slice(i), ...cyclePath.slice(0, i)];
         }
      }

      return cyclePath;
   }
}

module.exports = Analyzer;
module.exports.normalizeModule = normalizeModule;
