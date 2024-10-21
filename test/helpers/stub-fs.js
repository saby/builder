'use strict';

const sinon = require('sinon');
const fs = require('fs-extra');
const { path, toPosix } = require('../../lib/platform/path');

function resolvePath(cwd, filePath) {
   const nFilePath = toPosix(filePath);

   if (!cwd) {
      return nFilePath;
   }

   if (nFilePath.startsWith(cwd)) {
      return path.relative(cwd, nFilePath);
   }

   return nFilePath;
}

function createFileStats(isDirectory) {
   return {
      mtime: { getTime: () => 0 },
      isDirectory: () => isDirectory
   };
}

/**
 * Создать фейковую функцию-обработчик, которая будет подставлена на место целевой библиотечной функции.
 * @param {sinon.SinonSandbox} sandbox Песочница, соответствующая одному тесту.
 * @param {string} cwd Текущая рабочая директория, чтобы тесты могли запускаться на разных тачках.
 * @param {Map} map Словарь фейковых файлов, доступных для чтения и записи.
 * @param {Function} callback Функция-коллбек, которая будет вызываться при вызове оригинальной функции,
 * и которая принимает в качестве аргументов словарь (содержит фейковые файлы),
 * путь до файла и прочие аргументы вызова.
 * @returns {[AsyncFunction,Function]} Возвращается пара из асинхронной и синхронной фейковых функций.
 */
function stubFileAccessor(sandbox, cwd, map, callback) {
   return sandbox.fake(function fileAccessor(filePath, ...args) {
      const key = resolvePath(cwd, filePath);

      return callback(map, key, ...args);
   });
}

/**
 * Создать коллбек функцию, которая возвращает данные из переданного словаря.
 * @param {any} defaultReturnValue Возвращаемое значение по умолчанию, если в словаре не содержится запрашиваемый ключ.
 * @returns {Function} Возврашает функцию-геттер, вида (map, key) => { ... }.
 */
function createGetCallback(defaultReturnValue) {
   return (map, key) => {
      if (map.has(key)) {
         return map.get(key);
      }

      return defaultReturnValue;
   };
}

/**
 * Создать коллбек функцию, которая устанавливает данные в переданный словарь.
 * @param {boolean} ifNotExist Флаг установки нового значения только когда указанный ключ не содержится в словаре.
 * @returns {Function} Возврашает функцию-сеттер, вида (map, key, value) => { ... }.
 */
function createSetCallback(ifNotExist = false) {
   return (map, key, value) => {
      if (ifNotExist && map.has(key)) {
         return;
      }

      map.set(key, value);
   };
}

/**
 * Создать коллбек функцию, которая проверяет наличие ключа в словаре.
 * @param {any} defaultReturnValue Возвращаемое значение по умолчанию, если в словаре не содержится запрашиваемый ключ.
 * @returns {Function} Возврашает функцию, вида (map, key) => { ... }.
 */
function createHasCallback(defaultReturnValue) {
   return (map, key) => map.has(key) || defaultReturnValue;
}

/**
 * Создать коллбек функцию, которая удаляет ключ из словаря.
 * @returns {Function} Возврашает функцию, вида (map, key) => { ... }.
 */
function createDeleteCallback() {
   return (map, key) => map.delete(key);
}

/**
 * Установить на функции библиотеки fs-extra заглушки, чтобы в тестах проверять взаимодействия с файловой системой.
 * @param {string} cwd Текущая рабочая директория, чтобы тесты могли запускаться на разных тачках.
 * @returns {object} Возврашает объект, предоставляющий методы контроля и проверки работы с файловой системой.
 */
function stubFsExtra(cwd) {
   const nCwd = toPosix(cwd);
   const sandbox = sinon.createSandbox();
   const files = new Map();
   const stats = new Map();

   const readFile = stubFileAccessor(sandbox, nCwd, files, createGetCallback(''));
   const readJson = stubFileAccessor(sandbox, nCwd, files, createGetCallback({ }));
   const lstat = stubFileAccessor(sandbox, nCwd, stats, createGetCallback(undefined));
   const readdir = stubFileAccessor(sandbox, nCwd, files, createGetCallback([]));
   const pathExists = stubFileAccessor(sandbox, nCwd, files, createHasCallback(false));
   const outputJson = stubFileAccessor(sandbox, nCwd, files, createSetCallback());
   const outputFile = stubFileAccessor(sandbox, nCwd, files, createSetCallback());
   const remove = stubFileAccessor(sandbox, nCwd, files, createDeleteCallback());
   const ensureSymlink = stubFileAccessor(sandbox, nCwd, files, createSetCallback(true));

   // Здесь нам не важно, каким способом и через какую функцию происходит запись или чтение данных.
   // Поэтому функции-фейки идентичны для алиасов и сихронных/асинхронных вариантов.
   const overrides = {
      readFile,
      readFileSync: readFile,
      readJson,
      readJSON: readJson,
      readJSONSync: readJson,
      lstat,
      lstatSync: lstat,
      readdir,
      readdirSync: readdir,
      pathExists,
      pathExistsSync: pathExists,
      outputJson,
      outputJSON: outputJson,
      outputJsonSync: outputJson,
      outputJSONSync: outputJson,
      outputFile,
      outputFileSync: outputFile,
      remove,
      removeSync: remove,
      ensureSymlink,
      ensureSymlinkSync: ensureSymlink
   };
   const promiseOverrides = {
      rm: remove
   };

   sandbox.stub(fs);
   for (const method in overrides) {
      if (overrides.hasOwnProperty(method)) {
         fs[method].callsFake(overrides[method]);
      }
   }

   sandbox.stub(fs.promises);
   for (const method in promiseOverrides) {
      if (promiseOverrides.hasOwnProperty(method)) {
         fs.promises[method].callsFake(promiseOverrides[method]);
      }
   }

   overrides.promises = promiseOverrides;

   return {
      cwd: nCwd,
      files,
      overrides,
      sandbox,
      stubFile(filePath, contents) {
         const nFilePath = resolvePath(this.cwd, filePath);

         files.set(nFilePath, contents);
         stats.set(nFilePath, createFileStats(false));
      },
      stubDirectory(filePath, contents = []) {
         const nFilePath = resolvePath(this.cwd, filePath);

         files.set(nFilePath, contents);
         stats.set(nFilePath, createFileStats(true));
      },
      restore() {
         sandbox.restore();
      }
   };
}

module.exports = stubFsExtra;
