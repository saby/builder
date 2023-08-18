/* eslint-disable max-classes-per-file */

/**
 * @author Krylov M.A.
 */

'use strict';

const gulp = require('gulp');
const fs = require('fs-extra');
const { exec } = require('child_process');
const EXIT_SIGNALS = new Set(['SIGTERM', 'SIGINT', 'SIGKILL']);

const ConfigurationReader = require('../common/configuration-reader');
const {
   path,
   cwd,
   toPosix,
   toPlatform
} = require('../../lib/platform/path');

const logger = require('../../lib/logger').logger();

const GULP_PATH = require.resolve('gulp/bin/gulp');

/**
 * Интервал, с которым gulp.watch присылает изменения
 * @type {number}
 */
const GULP_WATCH_DELAY = 200;

/**
 * Интервал, с которым проверяется очередь измененных файлов
 * @type {number}
 */
const WATCH_INTERVAL_DELAY = 700;

/**
 * Интервал, в течение которого watcher принимает изменения, прежде чем запустит сборку
 * @type {number}
 */
const BUILD_PROCESS_DELAY = 1500;

/**
 * Предельное количество файлов, при котором запускается частичная пересборка по изменениям.
 * Если это количество превышено, то запускается полная сборка.
 * Это актуально для ситуаций, когда происходит:
 * - переключение на другую ветку;
 * - обновление зависимых репозиториев.
 * @type {number}
 */
const REBUILD_FILES_LIMIT = 300;

/**
 * Опции, с которыми порождается процесс сборки
 */
const CHILD_PROCESS_OPTIONS = {
   maxBuffer: 1024 * 500,
   cwd: cwd()
};

/**
 * Ограничение по памяти для дочернего процесса сборки.
 * Node parameter --max-old-space-size.
 * @type {number}
 */
const CHILD_PROCESS_MAX_OLD_SPACE_SIZE = 16384;

/**
 * Получить переменные окружения из process.argv.
 * @returns {{sourceDir: string, parameters, gulpConfig}} Окружение watcher.
 */
function getEnvironment() {
   const parameters = ConfigurationReader.getProcessParameters(process.argv);
   const gulpConfig = ConfigurationReader.readConfigFileSync(parameters.config, cwd());
   const sourceDir = toPosix(`${gulpConfig.cache}/temp-modules`);

   return {
      sourceDir,
      parameters,
      gulpConfig
   };
}

/**
 * Получить реальные пути до модулей, изменения которых необходимо отслеживать.
 * @param {object} gulpConfig Конфигурация сборки.
 * @returns {string[]} Список реальных путей до модулей.
 */
function getRealWatchingPaths(gulpConfig) {
   const result = [];

   gulpConfig.modules.forEach((module) => {
      if (typeof module.compiled === 'boolean' && module.compiled) {
         return;
      }

      // Смотрим сразу в реальную директорию, поскольку модули могут быть заданы через симлинки.
      const realPath = fs.realpathSync(module.path);

      result.push(`${toPosix(realPath)}/`);
   });

   return result;
}

/**
 * Заблокировать путь до исходных файлов, установив lockfile.
 * @param {object} gulpConfig Конфигурация сборки.
 */
function lockCacheSymlinks(gulpConfig) {
   const lockFilePath = path.join(gulpConfig.cache, 'temp-modules.lockfile');

   if (fs.existsSync(lockFilePath)) {
      return;
   }

   fs.outputFileSync(lockFilePath, '', { flag: 'w+' });

   logger.info(`Created lockfile ${lockFilePath}`);

   const onExitHandler = () => {
      if (fs.existsSync(lockFilePath)) {
         fs.rmSync(lockFilePath, { force: true });

         logger.info(`Removed lockfile ${lockFilePath}`);
      }
   };

   process.on('SIGINT', onExitHandler);
   process.on('SIGKILL', onExitHandler);
   process.on('SIGTERM', onExitHandler);
}

/**
 * Обертка над child_process.
 */
class ChildProcess {
   constructor() {
      this.isAvailable = true;
   }

   exec(cmd, callback) {
      this.isAvailable = false;

      const child = exec(cmd, CHILD_PROCESS_OPTIONS, (error, stdout, stderr) => {
         if (typeof callback === 'function') {
            callback(error, stdout, stderr);
         }

         this.isAvailable = true;
      });

      child.stdout.pipe(process.stdout);
      child.stderr.pipe(process.stderr);
   }
}

/**
 * Очередь файлов на пересборку, полученная от gulp.watch.
 */
class Queue {
   /**
    * Инициализировать инстанс очереди.
    * @param {string[]} roots Список реальных путей до модулей, за которыми установлено прослушивание.
    */
   constructor(roots) {
      this.roots = roots;
      this.files = new Set();
      this.modules = { };
   }

   /**
    * Получить количество файлов на пересборку.
    * @returns {number}
    */
   get size() {
      return this.files.size;
   }

   /**
    * Добавить файл в очередь.
    * @param {string} rawFullPath Полный путь до измененного файла.
    */
   add(rawFullPath) {
      const fullPath = toPosix(rawFullPath);
      const filePath = this._getRelativePath(fullPath);

      if (!filePath) {
         logger.info(`Received changed file "${fullPath}" which is out of project`);
         return;
      }

      this.files.add(filePath);
      this._addChangedFile(filePath);
   }

   /**
    * Добавить файл в очередь.
    * @param {string} rawFullPath Полный путь до удаленного файла.
    */
   remove(rawFullPath) {
      const fullPath = toPosix(rawFullPath);
      const filePath = this._getRelativePath(fullPath);

      if (!filePath) {
         logger.info(`Received removed file "${fullPath}" which is out of project`);
         return;
      }

      if (this.files.has(filePath)) {
         // одновременно произошло добавление и удаление файла
         const moduleName = filePath.split('/')[0];
         this.modules[moduleName].changedFiles.delete(path.relative(moduleName, filePath));

         this.files.delete(filePath);

         return;
      }

      this._addDeletedFile(filePath);
   }

   /**
    * Выгрузить объект с помодульными изменениями в формате changedFiles / deletedFiles.
    * @returns {object}
    */
   flush() {
      const changes = { };

      for (const moduleName in this.modules) {
         if (this.modules.hasOwnProperty(moduleName)) {
            changes[moduleName] = {
               changedFiles: Array.from(this.modules[moduleName].changedFiles),
               deletedFiles: Array.from(this.modules[moduleName].deletedFiles)
            };
         }
      }

      this._clean();

      return changes;
   }

   /**
    * Очистить очередь
    * @private
    */
   _clean() {
      this.files.clear();

      for (const moduleName in this.modules) {
         if (this.modules.hasOwnProperty(moduleName)) {
            this.modules[moduleName].changedFiles.clear();
            this.modules[moduleName].deletedFiles.clear();
         }
      }
   }

   /**
    * Получить относительный путь от корня модуля.
    * @param {string} fullPath Полный путь до файла.
    * @returns {undefined|string}
    * @private
    */
   _getRelativePath(fullPath) {
      const rootDir = this.roots.find(dir => fullPath.startsWith(dir));

      if (!rootDir) {
         return undefined;
      }

      return path.relative(path.dirname(rootDir), fullPath);
   }

   /**
    * Установить файл как измененный.
    * @param {string} filePath Путь до файла от корня модуля.
    * @private
    */
   _addChangedFile(filePath) {
      const moduleName = filePath.split('/')[0];
      this._ensureModule(moduleName);

      this.modules[moduleName].changedFiles.add(path.relative(moduleName, filePath));
   }

   /**
    * Установить файл как удаленный.
    * @param {string} filePath Путь до файла от корня модуля.
    * @private
    */
   _addDeletedFile(filePath) {
      const moduleName = filePath.split('/')[0];
      this._ensureModule(moduleName);

      this.modules[moduleName].deletedFiles.add(path.relative(moduleName, filePath));
   }

   /**
    * Инициализровать модуль в хранилище, если его нет.
    * @param {string} moduleName Имя модуля.
    * @private
    */
   _ensureModule(moduleName) {
      if (!this.modules[moduleName]) {
         this.modules[moduleName] = {
            changedFiles: new Set(),
            deletedFiles: new Set()
         };
      }
   }
}

/**
 * Состояние вотчера: сканирование директорий.
 * @type {number}
 */
const STATE_WATCHER_SCANNING = 0;

/**
 * Состояние вотчера: готов к получению изменений.
 * @type {number}
 */
const STATE_WATCHER_READY = 1;

/**
 * Состояние вотчера: получение входящих изменений.
 * @type {number}
 */
const STATE_WATCHER_RECEIVING = 2;

/**
 * Состояние вотчера: запущена пересборка изменений.
 * @type {number}
 */
const STATE_WATCHER_BUILD_REQUESTED = 3;

/**
 * Состояние вотчера: работа остановлена.
 * @type {number}
 */
const STATE_WATCHER_BUILD_CLOSED = 4;

/**
 * Класс, реализующий основную логику watcher.
 */
class Watcher {
   /**
    * Инициализировать новый инстанс.
    * @param {{parameters: string[], sourceDir: string, gulpConfig, parameters}} env Окружение watcher.
    * @param {string[]} roots Список реальных путей до модулей, за которыми установлено наблюдение.
    */
   constructor(env, roots) {
      this.env = env;
      this.roots = roots;
      this.queue = new Queue(roots);
      this.buildProcess = new ChildProcess();

      this.previousQueueSize = this.queue.size;
      this.previousProcessingTime = Date.now();

      this.state = STATE_WATCHER_SCANNING;
      this.watcher = undefined;
   }

   /**
    * Запустить watcher.
    */
   start() {
      this.watcher = gulp.watch(this.roots, {
         delay: GULP_WATCH_DELAY,
         ignorePermissionErrors: true
      });

      const withTimer = (cb, ...args) => {
         this.previousProcessingTime = Date.now();

         cb(...args);

         this.previousProcessingTime = Date.now();
      };

      const onUpdateHandler = fullPath => withTimer(() => this.queue.add(toPosix(fullPath)));
      const onRemoveHandler = fullPath => withTimer(() => this.queue.remove(toPosix(fullPath)));

      this.watcher.on('ready', () => {
         logger.info('Initial scanning completed.');

         // После сканирования всех директорий watcher готов к полноценной работе.
         setInterval(this._processQueue.bind(this), WATCH_INTERVAL_DELAY);
      });
      this.watcher.on('add', onUpdateHandler);
      this.watcher.on('change', onUpdateHandler);
      this.watcher.on('unlink', onRemoveHandler);
      this.watcher.on('error', (error) => {
         logger.error(error);
      });

      logger.info(`Initial scanning of ${this.roots.length} directories...`);
   }

   /**
    * Завершить работу watcher.
    */
   close() {
      if (this._updateState(STATE_WATCHER_BUILD_CLOSED)) {
         logger.info('Watcher stopped.');

         if (this.watcher) {
            this.watcher.close();
         }
      }
   }

   /**
    * Обновить состояние watcher.
    * @param {number} state Новое состояние
    * @returns {boolean} true, если состояние было изменено.
    * @private
    */
   _updateState(state) {
      if (this.state === state) {
         return false;
      }

      this.state = state;
      return true;
   }

   /**
    * Обработать очередь изменений.
    * @private
    */
   _processQueue() {
      if (this.queue.size === 0 || !this.buildProcess.isAvailable) {
         // Изменений еще нет или ожидается пересборка полученных изменений.
         return;
      }

      if (this._updateState(STATE_WATCHER_RECEIVING)) {
         logger.info('Receiving changes...');
      }

      const timeout = Date.now() - this.previousProcessingTime;
      const queueSize = this.queue.size;

      if (this.previousQueueSize < queueSize) {
         // Продолжаем получать измененные файлы. Сбросим таймер
         this.previousProcessingTime = Date.now();
         this.previousQueueSize = queueSize;

         return;
      }

      // Чтобы не дробить большую пачку изменений на несколько, увеличим период ожидания
      // получения изменений в зависимости от размера текущей очереди.
      // Сетка зависит от GULP_WATCH_DELAY, WATCH_INTERVAL_DELAY.
      const shouldRunBuilder = (
         (queueSize < 30 && timeout > BUILD_PROCESS_DELAY) ||
         (queueSize < 300 && timeout > 2 * BUILD_PROCESS_DELAY) ||
         (queueSize < 900 && timeout > 3 * BUILD_PROCESS_DELAY) ||
         (timeout > 4 * BUILD_PROCESS_DELAY)
      );

      if (!shouldRunBuilder) {
         // Время ожидания еще не вышло, но новые файлы перестали поступать. Подождем
         return;
      }

      this._runBuilder();
   }

   /**
    * Запустить процесс пересборки по списку измененных файлов.
    * @private
    */
   _runBuilder() {
      if (!this.buildProcess.isAvailable) {
         return;
      }

      const files = Array.from(this.queue.files);
      const onExit = () => {
         logger.info(`Finished rebuild of ${files.length} file${files.length > 1 ? 's' : ''}`);

         // Сообщить родительскому процессу (wasaby-cli), что закончилась пересборка следующих файлов,
         // если установлено IPC соединение.
         if (process.connected) {
            files.forEach(filePath => process.send({ filePath }));
         }

         if (this._updateState(STATE_WATCHER_READY)) {
            logger.info('Watching for changes...');
         }
      };

      const changes = this.queue.flush();
      const changesFilePath = path.join(this.env.sourceDir, 'watcher_changed_files.json');

      fs.outputJsonSync(changesFilePath, changes, { spaces: 3 });

      let cmd = (
         'node' +
         ` "${toPlatform(GULP_PATH)}"` +
         ' build' +
         ` --config="${toPlatform(this.env.parameters.config)}"` +
         ` --max-old-space-size=${CHILD_PROCESS_MAX_OLD_SPACE_SIZE}` +
         ' --symlinksExist=true' +
         ' --log-level=info'
      );

      if (this._updateState(STATE_WATCHER_BUILD_REQUESTED)) {
         if (files.length < 10) {
            logger.info(`Received changes: ${JSON.stringify(files, null, 3)}`);
         }

         if (files.length < REBUILD_FILES_LIMIT) {
            cmd += ` --watcherChangedFiles="${toPlatform(changesFilePath)}"`;

            logger.info(`Started rebuild of ${files.length} file${files.length > 1 ? 's' : ''}`);

            this.buildProcess.exec(cmd, onExit);

            return;
         }

         logger.info(`Started full rebuild: too much changes have been received (${files.length} >= ${REBUILD_FILES_LIMIT})`);

         this.buildProcess.exec(cmd, onExit);
      }
   }
}

/**
 * Создать watcher задачу для gulp.
 */
function generateBuildOnChangeWatcher(done) {
   const env = getEnvironment();
   const roots = getRealWatchingPaths(env.gulpConfig);
   const watcher = new Watcher(env, roots);

   process.env.logFolder = env.gulpConfig.logs;
   process.env.cacheFolder = env.gulpConfig.cache;

   process.on('exit', (code, signal) => {
      if (EXIT_SIGNALS.has(signal)) {
         logger.debug(`Got signal ${signal}. Closing watcher`);
         watcher.close();
      }
      done();
   });

   lockCacheSymlinks(env.gulpConfig);
   fs.outputJsonSync(path.join(env.gulpConfig.logs, 'directories_to_watch.json'), roots, { spaces: 3 });

   watcher.start();
}

module.exports = generateBuildOnChangeWatcher;
