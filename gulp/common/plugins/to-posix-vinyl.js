'use strict';

const through = require('through2');
const PosixVinyl = require('../../../lib/platform/vinyl');
const logger = require('../../../lib/logger').logger();

module.exports = function declarePlugin(moduleInfo) {
   return through.obj((file, encoding, callback) => {
      // если находим файл с пустым содержимым, ругаемся ошибкой. Такие файлы
      // могут возникать в результате криво разрешённых конфликтов при переименовании расширения
      // (например ts в tsx), и это приведёт к ошибке на стенде.
      if (file.contents.length === 0) {
         logger.warning({
            message: 'Обнаружен файл с пустым содержимым, необходимо удалить его из исходников!',
            moduleInfo,
            filePath: file.relative
         });
      }

      callback(null, PosixVinyl.from(file));
   });
};
