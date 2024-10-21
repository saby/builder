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

const Digraph = require('../struct/digraph');

const transliterate = require('../transliterate');
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
 * Проверить, является ли зависимость потенциальным Npm пакетом или Node.js модулем.
 * Такие зависимости не нужно обрабатывать.
 * @param {RequireJSModule} module Проверяемая зависимость.
 * @return {boolean}
 */
function isPossiblyNpmPackageOrNodeModule(module) {
   return !module.name.includes('/');
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

   nModule.deletePlugin('browser');
   nModule.deletePlugin('is');
   nModule.deletePlugin('normalize');
   nModule.deletePlugin('optional');
   nModule.deletePlugin('order');
   nModule.deletePlugin('preload');

   return nModule;
}

/**
 * Проверить, существует ли файл, соответствующий зависимости.
 * @param {string} baseDir Корневая директория с интерфейсными модулями.
 * @param {RequireJSModule} module Обрабатываемая зависимость
 * @return {Promise<boolean>} Возвращает true, если для зависимости существует исходный файл.
 */
async function moduleFileExists(baseDir, module) {
   // TODO: научиться обрабатывать плагин font
   const filePath = normalizeModuleName(module.name);

   if (module.plugins.size === 0) {
      return (
         await fs.pathExists(path.join(baseDir, `${filePath}.ts`)) ||
         await fs.pathExists(path.join(baseDir, `${filePath}.tsx`)) ||
         await fs.pathExists(path.join(baseDir, `${filePath}.js`)) ||
         fs.pathExists(path.join(baseDir, `${filePath}.d.ts`))
      );
   }

   if (module.hasPlugin('text')) {
      return fs.pathExists(path.join(baseDir, filePath));
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

   if (module.hasPlugin('json')) {
      return fs.pathExists(path.join(baseDir, filePath));
   }

   if (module.hasPlugin('js')) {
      return fs.pathExists(path.join(baseDir, `${filePath}.js`));
   }

   return false;
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

class Analyzer {
   /**
    * Инициализировать новый инстанс.
    * @param {WriteStream} stream Поток, в который выводятся логи.
    * @param {ModuleInfo[]} modules Коллекция обрабатываемых модулей.
    */
   constructor(stream, modules) {
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
      this.graph = new Digraph();

      /**
       * Коллекция обрабатываемых модулей проекта.
       * @type {Map<string, ModuleInfo>}
       */
      this.modules = new Map(modules.map((moduleInfo => [
         transliterate(moduleInfo.name),
         moduleInfo
      ])));
   }

   /**
    * Загрузить служебные артефакты, необходимые для анализа зависимостей.
    * @param {string} baseDir Корневая директория с интерфейсными модулями.
    * @return {Promise<void[]>}
    */
   load(baseDir) {
      const modules = Array.from(this.modules.values());
      const handler = this.loadModuleArtifacts.bind(this, baseDir);

      return Promise.all(modules.map(handler));
   }

   /**
    * Добавить модуль в список анализируемых.
    * @param {string} filePath Путь до файла, соответствующий обрабатываемому модулю.
    * @param {string} moduleName Имя зависимости обрабатываемого модуля.
    * @param {string[]} dependencies Список зависимостей обрабатываемого модуля.
    */
   putModule(filePath, moduleName, dependencies) {
      const children = [];

      for (const dependency of (dependencies || [])) {
         const target = parseDependency(dependency);

         if (this.filterDependency(target)) {
            children.push(normalizeModule(target).raw);
         }
      }

      this.graph.put(moduleName, children);
      this.files.set(moduleName, filePath);
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
         const sourcesStr = sources.map(this.files.get.bind(this.files)).join(', ');

         if (await moduleFileExists(baseDir, module)) {
            if (module.hasPlugin('css')) {
               // Зависимость существует на диске, значит мы обработали ее не регистрируя в input-paths.
               continue;
            }

            // TODO: после обкатки заменить на использование логгера
            // Сюда попадают в том числе кейсы в ts вида export = <some-type>.
            this.stream.write(`[WARN] Обнаружен неизвестный модуль, о котором нет информации.\n\tМодуль: ${rawModule}\n\tИспользуется в: ${sourcesStr}\n`);

            continue;
         }

         // TODO: после обкатки заменить на использование логгера
         // Сюда попадают все кейсы, когда зависимость не удалось найти.
         this.stream.write(`[ERROR] Не удалось найти модуль соответствующий указанной зависимости.\n\tЗависимость: ${rawModule}\n\tИспользуется в: ${sourcesStr}\n`);
      }
   }

   /**
    * Проверить граф на наличие циклических зависимостей.
    */
   testCycles() {
      const cycles = this.graph.testCycles();

      cycles.forEach((cyclePath) => {
         // TODO: после обкатки заменить на использование логгера
         this.stream.write(`[ERROR] Обнаружена циклическая зависимость:\n${cyclePath.map(v => `\t-> ${v}`).join('\n')}\n`);
      });
   }

   /**
    * Определить необходимость обработки конкретной зависимости.
    * @param {RequireJSModule} module Обрабатываемая зависимость.
    * @returns {boolean} Возвращает true, если зависимость следует обработать.
    */
   filterDependency(module) {
      // Порядок следования проверок важен!
      // Сначала более строгие проверки.

      if (ModuleParameters.has(module.name)) {
         // Не учитываем служебные зависимости модуля.
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

      if (module.hasPlugin('i18n') || module.hasPlugin('datasource') || module.hasPlugin('font')) {
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
         return this.modules.has(module.uiName);
      }

      return true;
   }

   /**
    * Загрузить необходимые артефакты для модуля.
    * @param {string} baseDir Корневая директория с интерфейсными модулями.
    * @param {ModuleInfo} moduleInfo Обрабатываемый модуль.
    * @return {Promise<void>}
    */
   async loadModuleArtifacts(baseDir, moduleInfo) {
      const componentsArtifactPath = path.join(baseDir, transliterate(moduleInfo.name), '.cache', 'components-info.json');

      await withJsonFile(componentsArtifactPath, (json) => {
         this.putComponentDependencies(json);
         this.putMarkupDependencies(json);
      });

      const inputFilesArtifactPath = path.join(baseDir, transliterate(moduleInfo.name), '.cache', 'input-paths.json');

      await withJsonFile(inputFilesArtifactPath, (json) => {
         this.putInputFiles(json);
      });
   }

   /**
    * Обработать JS компоненты артефакта components-info.json.
    * @param {object} json Содержимое артефакта.
    */
   putComponentDependencies(json) {
      for (const fPath in json.componentsInfo) {
         if (json.componentsInfo.hasOwnProperty(fPath)) {
            const componentsInfoElement = json.componentsInfo[fPath];

            if (!componentsInfoElement.hasOwnProperty('componentName')) {
               continue;
            }

            try {
               if (componentsInfoElement.privateDependencies) {
                  // Обрабатываем библиотеку. Необходимо смотреть в реальные зависимости модуля.
                  this.putModule(fPath, componentsInfoElement.componentName, componentsInfoElement.realDep);

                  continue;
               }

               this.putModule(fPath, componentsInfoElement.componentName, componentsInfoElement.componentDep);
            } catch (error) {
               // TODO: после обкатки заменить на использование логгера
               // Сюда попадают кейсы, например, с реактом:
               // когда один и тот же модуль в разных файлах (debug, release).
               // Не ошибка, но на всякий случай полезная информация для нас.
               this.stream.write(`[DEBUG] Ошибка при обработке componentsInfo.\n\tФайл: ${fPath}\n\tОшибка: ${error.message}\n`);
            }
         }
      }
   }

   /**
    * Обработать шаблоны артефакта components-info.json.
    * @param {object} json Содержимое артефакта.
    */
   putMarkupDependencies(json) {
      for (const fPath in json.markupCache) {
         if (json.markupCache.hasOwnProperty(fPath)) {
            const markupCacheElement = json.markupCache[fPath];

            try {
               this.putModule(fPath, markupCacheElement.nodeName, markupCacheElement.dependencies);
            } catch (error) {
               // TODO: после обкатки заменить на использование логгера
               // Сюда попадают кейсы:
               // когда один и тот же модуль в разных файлах (debug, release).
               // Не ошибка, но на всякий случай полезная информация для нас.
               this.stream.write(`[DEBUG] Ошибка при обработке markupCache.\n\tФайл: ${fPath}\n\tОшибка: ${error.message}\n`);
            }
         }
      }
   }

   /**
    * Обработать файлы артефакта input-paths.json.
    * @param {object} json Содержимое артефакта.
    */
   putInputFiles(json) {
      for (const filePath in json.paths) {
         if (json.paths.hasOwnProperty(filePath)) {
            if (filePath.endsWith('.json')) {
               // Добавляем JSON зависимости, которые отсутствуют в components-info.json
               const moduleName = `json!${transliterate(getPrettyPath(filePath))}`;

               this.putModule(filePath, moduleName, []);

               continue;
            }

            if (filePath.endsWith('.less') || filePath.endsWith('.css')) {
               if (json.paths[filePath].output.some(f => f.endsWith('.css'))) {
                  // Добавляем CSS зависимости, которые отсутствуют в components-info.json
                  const moduleName = `css!${transliterate(getPrettyPath(filePath)).replace(/\.(less|css)$/gi, '')}`;

                  this.putModule(filePath, moduleName, []);
               }
            }
         }
      }
   }
}

module.exports = Analyzer;
module.exports.normalizeModule = normalizeModule;
