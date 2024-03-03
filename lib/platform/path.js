'use strict';

const path = require('path');

/**
 * Получить текущую рабочую директорию процесса в POSIX формате.
 * @returns {string} Текущая рабочая директория процесса в POSIX формате.
 */
function cwd() {
   return toPosix(process.cwd());
}

/**
 * Нормализовать сетевой Win32 путь.
 * @param {string } filePath Путь в Win32 формате.
 * @returns {string} Нормализованный сетевой Win32 путь.
 */
function normalizeNetworkPath(filePath) {
   const networkRe = /^\\+/g;
   const networkSub = path.win32.sep.repeat(2);

   return filePath.replace(networkRe, networkSub);
}

/**
 * Преобразовать и нормализовать путь к Win32 формату.
 * @param {string } filePath Путь в любом формате.
 * @returns {string} Нормализованный путь в Win32 формате.
 */
function toWin32(filePath) {
   if (typeof filePath !== 'string' || !filePath) {
      return '';
   }

   const sepRe = /[/\\]+/g;

   return filePath.replace(sepRe, path.win32.sep);
}

/**
 * Преобразовать и нормализовать путь к POSIX формату.
 * @param {string } filePath Путь в любом формате.
 * @returns {string} Нормализованный путь в POSIX формате.
 */
function toPosix(filePath) {
   // Previous function name is unixifyPath.
   if (typeof filePath !== 'string' || !filePath) {
      return '';
   }

   const sepRe = /[/\\]+/g;

   return path
      .normalize(filePath)
      .replace(sepRe, path.posix.sep);
}

/**
 * Преобразовать путь к POSIX формату, нормализуя абсолютный путь.
 * Если путь является сетевым Win32-путем, то путь преобразуется к Win32 формату.
 * @param {string } filePath Путь в любом формате.
 * @returns {string} Путь в POSIX формате, либо сетевой Win32-путь в Win32 формате.
 */
function toSafePosix(filePath) {
   if (typeof filePath !== 'string' || !filePath) {
      return '';
   }

   const networkRe = /^[/\\]{2}/g;
   if (process.platform === 'win32' && networkRe.test(filePath)) {
      return normalizeNetworkPath(toWin32(filePath));
   }

   return toPosix(filePath);
}

/**
 * Преобразовать путь в формат, соответствующей текущей платформе.
 * @param {string } filePath Путь в любом формате.
 * @returns {string} Путь в формате, соответствующем текущей платформе.
 */
function toPlatform(filePath) {
   if (process.platform === 'win32') {
      return toWin32(filePath);
   }

   return toPosix(filePath);
}

function getRelativePath(root, filePath, outputRoot) {
   let pathWithoutRoot = toPosix(filePath).replace(root, '');

   if (outputRoot) {
      pathWithoutRoot = pathWithoutRoot.replace(outputRoot, '');
   }

   return removeLeadingSlashes(pathWithoutRoot);
}

function removeLeadingSlashes(filePath) {
   let newFilePath = filePath;

   if (newFilePath) {
      let head = newFilePath.charAt(0);

      while (head === '/' || head === '\\') {
         newFilePath = newFilePath.substr(1);
         head = newFilePath.charAt(0);
      }
   }

   return newFilePath;
}

function getFirstDirInRelativePath(relativePath) {
   const dblSlashes = /\\/g;
   const parts = relativePath.replace(dblSlashes, '/').split('/');

   // в пути должно быть минимум два элемента: имя папки модуля и имя файла.
   if (parts.length < 2) {
      return relativePath;
   }

   // если путь начинается со слеша, то первый элемент - пустая строка
   return parts[0] || parts[1];
}

function fn(name) {
   return (...args) => path.posix[name](...args.map(v => toPosix(v)));
}

function fnPlatform(name) {
   return (...args) => toPosix(path[name](...args.map(v => toPlatform(v))));
}

module.exports = {
   path: {
      normalize: fn('normalize'),
      join: fn('join'),
      resolve: fnPlatform('resolve'),
      isAbsolute: fn('isAbsolute'),
      relative: fn('relative'),
      dirname: fn('dirname'),
      basename: fn('basename'),
      extname: fn('extname'),
      sep: path.posix.sep,
      delimiter: path.posix.delimiter
   },
   cwd,
   toWin32,
   toPosix,
   toPlatform,
   normalizeNetworkPath,
   toSafePosix,
   getRelativePath,
   removeLeadingSlashes,
   getFirstDirInRelativePath
};
