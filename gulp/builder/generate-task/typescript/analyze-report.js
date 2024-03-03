/**
 * Задача анализации логов компиляции Typescript.
 *
 * Здесь происходит разбор диагностических сообщений и их обработка в зависимости от категории кода ошибки
 * (диагностические сообщения категоризированы автоматически в файле resources/typescript-diagnostic-messages.js).
 *
 * Критические ошибки вне зависимости от того, включен ли в модуле typeCheck или нет, всегда роняют сборку.
 * Все остальные ошибки и предупреждения выводятся в зависимости от флага typeCheck, заданного в s3mod файле модуля.
 *
 * @author Krylov M.A.
 */
/* eslint-disable prefer-destructuring */
'use strict';

const fs = require('fs-extra');
const logger = require('../../../../lib/logger').logger();
const { path } = require('../../../../lib/platform/path');
const { formatEntry } = require('../../../../lib/logger');

const typescriptDiagnosticMessages = require('../../../../resources/typescript-diagnostic-messages');

/**
 * Сборка Typescript произошла без ошибок.
 * @type {number}
 */
const SUCCESS_CODE = 0;

/**
 * Сборка Typescript произошла с предупреждениями.
 * @type {number}
 */
const WARNING_CODE = 1;

/**
 * Сборка Typescript произошла с ошибками. Сборку предпочтительно завершить.
 * @type {number}
 */
const ERROR_CODE = 2;

/**
 * Сборка Typescript произошла с критическими ошибками. Сборка должна быть завершена немедленно.
 * @type {number}
 */
const CRITICAL_ERROR_CODE = 3;

/**
 * Установить новый общий результирующий код typescript копиляции.
 * @param {number} currentCode Текущий код.
 * @param {number} newCode Новый код.
 * @returns {*}
 */
function getUpdatedCode(currentCode, newCode) {
   return currentCode < newCode ? newCode : currentCode;
}

/**
 * Разобрать многострочное диагностическое сообщение.
 * @param {string} message Сообщение, выводимое tsc компилятором.
 * @returns {object} Возвращает object represented диагностическое сообщение.
 */
function parseMessage(message) {
   const info = {
      raw: message
   };

   let error = message;
   let hasData = false;

   try {
      // Разбор модифицированного сообщения, в котором добавлена информация о модуле и ответственном.
      const locationRe = /^location:\s*\[module:\s*([^\s\]]+)(\s+[^\]]+)?\]\s*(.*)$/gs.exec(error);
      if (locationRe) {
         info.location = {
            module: locationRe[1]
         };

         error = locationRe[3];
      }

      // Разбор начала оригинального сообщения, которое начинается с пути до файла и локализации места ошибки в файле.
      const fileRe = /^([^(]+)(\(\d+,\d+\)):\s*(.*)$/gs.exec(error);
      if (fileRe) {
         info.file = {
            path: fileRe[1],
            loc: fileRe[2]
         };

         error = fileRe[3];

         if (!info.location && !info.file.path.startsWith('..')) {
            info.location = {
               module: info.file.path.split('/').shift()
            };
         }
      }

      // Выделение кода и текста ошибки.
      const errorRe = /^error\s*TS(\d+):\s*(.*)$/gs.exec(error);
      if (errorRe) {
         info.code = Number.parseInt(errorRe[1], 10);
         info.message = errorRe[2];
         hasData = true;
      }

      if (!hasData) {
         logger.debug(`Typescript report analyzer: could not parse line:\n${message}`);
      }
   } catch (e) {
      logger.debug(`Typescript report analyzer error: ${e.message}`);
   }

   return hasData ? info : { raw: message };
}

/**
 * Последовательно обработать многострочные диагностические сообщения.
 * @param {string} contents Содержимое файла с сообщениями от tsc.
 * @param {Function} callback Обработчик диагностического сообщения.
 */
function forEachMessage(contents, callback) {
   const lines = contents
      .replace(/\r/g, '')
      .split('\n');

   let lastMessage = '';
   for (const line of lines) {
      if (!line) {
         // Пропустить пустую строку
         continue;
      }

      if (line.startsWith(' ')) {
         // Продолжение предыдущего сообщения
         lastMessage += `\n${line}`;
         continue;
      }

      // Получено новое сообщение
      if (lastMessage) {
         // Сброс прошлого сообщения, если оно есть
         callback(parseMessage(lastMessage));
      }

      lastMessage = line;
   }

   if (lastMessage) {
      // Сброс прошлого сообщения, если оно есть
      callback(parseMessage(lastMessage));
   }
}

/**
 * Проверить, относится ли диагностическое сообщение к файлам из директории node_modules.
 * Примечание: используемые нами пакеты могут содержать некорректное описание типов, на которое мы повлиять не можем.
 * Такие ошибки необходимо игнорировать, и ни в коем случае не ронять сборку.
 * @param {object} info Распарсенное диагностическое сообщение Typescript.
 * @returns {boolean}
 */
function isMessageFromNodeModules(info) {
   return (
      typeof info.code === 'number' &&
      typeof info.file !== 'undefined' &&
      info.file.path.includes('/node_modules/')
   );
}

/**
 * Создать задачу анализа диагностических сообщений после работы tsc.
 * @param {TaskParameters} taskParameters Параметры сборки.
 * @param {string} logFile Путь до файла с диагностическими сообщениями.
 * @returns {function} Возвращает асинхронную функцию-задачу.
 */
function analyzeReport(taskParameters, logFile) {
   return async function analyzeReportTask() {
      if (!taskParameters.config.typescriptChanged) {
         return;
      }

      const modules = new Map(
         taskParameters.config.modules
            .map(moduleInfo => [moduleInfo.name, moduleInfo])
      );

      const totalContents = [];
      const contents = await fs.readFile(logFile, 'utf8');

      // TODO: для нужд анализа на время раскатки typecheck по модулям сохраняем оригинальный отчет в логах.
      await fs.copy(logFile, path.join(path.dirname(logFile), 'builder_compilation_errors_full_original.log'));

      let overallCode = SUCCESS_CODE;
      forEachMessage(contents, (info) => {
         // TODO: Не самое удачное место для кода, который относится только к unit тестам.
         //    Необходимо в целом избавиться от этого флага.
         if (process.env['builder-tests']) {
            if (process.env['builder-tests-skip-tsc-messages']) {
               return;
            }

            logger.info({
               message: info.raw
            });

            return;
         }

         if (isMessageFromNodeModules(info)) {
            return;
         }

         if (!info.location || !info.file) {
            // Сообщение об ошибке в файле вне проекта или об ошибке в конфигурации, либо текст ошибки плохо разобрали.
            // Такое сообщение пропускать нельзя.
            overallCode = getUpdatedCode(overallCode, ERROR_CODE);
            logger.error({
               message: info.raw
            });

            return;
         }

         const moduleInfo = modules.get(info.location.module);
         const formattedMessage = formatEntry({ message: info.raw, moduleInfo }).message;

         if (typescriptDiagnosticMessages.critical.has(info.code)) {
            // Критическая ошибка. Скопилированный код неработоспособен.
            overallCode = getUpdatedCode(overallCode, CRITICAL_ERROR_CODE);

            taskParameters.cache.markFileAsFailed(info.file.path);
            totalContents.push(formattedMessage);
            logger.error({
               message: info.raw,
               moduleInfo
            });

            return;
         }

         if (!moduleInfo) {
            logger.debug(`При обработке следующего сообщения не был найден соответствующий moduleInfo: ${JSON.stringify(info, null, 3)}`);

            return;
         }

         if (moduleInfo.typescript.typecheck || typescriptDiagnosticMessages.alwaysError.has(info.code)) {
            if (typescriptDiagnosticMessages.error.has(info.code)) {
               // Ошибка. Скопилированный код потенциально неработоспособен.
               overallCode = getUpdatedCode(overallCode, ERROR_CODE);

               taskParameters.cache.markFileAsFailed(info.file.path);
               totalContents.push(formattedMessage);
               logger.error({
                  message: info.raw,
                  moduleInfo
               });

               return;
            }

            if (typescriptDiagnosticMessages.warning.has(info.code)) {
               overallCode = getUpdatedCode(overallCode, WARNING_CODE);

               totalContents.push(formattedMessage);
               logger.warning({
                  message: info.raw,
                  moduleInfo
               });
            }
         }
      });

      let errorMessage;
      const tail = `More details in file: "${logFile}"`;
      if (overallCode === CRITICAL_ERROR_CODE) {
         errorMessage = `TypeScript compilation was completed with critical errors. ${tail}`;
         logger.error(errorMessage);
      } else if (overallCode === ERROR_CODE) {
         errorMessage = `TypeScript compilation was completed with errors. ${tail}`;
         logger.error(errorMessage);
      } else if (overallCode === WARNING_CODE) {
         logger.error(`TypeScript compilation was completed with warnings. ${tail}`);
      } else if (overallCode === SUCCESS_CODE) {
         logger.info('TypeScript compilation was completed successfully!');
      }

      await fs.outputFile(logFile, totalContents.join('\n'));

      if (errorMessage) {
         await fs.remove(taskParameters.config.tscCacheLockFile);
         throw new Error(errorMessage);
      }
   };
}

module.exports = analyzeReport;
module.exports.parseMessage = parseMessage;
module.exports.forEachMessage = forEachMessage;
